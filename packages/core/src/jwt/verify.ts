import { base64ToBytes } from '../base64/codec.ts'
import { timingSafeEqual } from '../hash/compare.ts'
import { hmac } from '../hash/hmac.ts'
import { isDerEcdsaSignature } from './der.ts'
import { detectKeyFormat, parseKey, type KeyCandidate, type KeyFormat, type SecretEncoding } from './keys.ts'
import { isPlainObject, parseJwt } from './parse.ts'

export type VerifyStatus = 'valid' | 'invalid' | 'error'

/**
 * 'valid' means the signature was made by the key, and nothing else: it says
 * nothing about exp or nbf, which `checkClaims` judges separately.
 * 'invalid' means a verifier must reject the token with this key: a wrong
 * signature, or a refusal such as `alg: none` or algorithm confusion.
 * 'error' means it could not be checked: a malformed token or key, or an
 * algorithm this runtime lacks.
 */
export interface VerifyResult {
  status: VerifyStatus
  /** The header's `alg` as sent, or null when there is none. */
  alg: string | null
  /** How the key input was read, or null when there was none. */
  format: KeyFormat | null
  /** The `kid` of the key that verified, or of the only key tried. */
  keyId?: string
  /** 0-based position in a JWKS of the key that verified. */
  keyIndex?: number
  /** Why, in a sentence or two. Set for every non-valid result, and for a valid one that carries a caveat. */
  reason?: string
}

export interface VerifyOptions {
  /** How an HS secret is written. Default 'text': most secrets are used as their literal UTF-8. */
  secretEncoding?: SecretEncoding
}

type Hash = 'SHA-256' | 'SHA-384' | 'SHA-512'

type AlgSpec =
  | { kind: 'hmac'; hash: Hash; bytes: number }
  | { kind: 'rsa'; name: 'RSASSA-PKCS1-v1_5' | 'RSA-PSS'; hash: Hash; saltLength: number }
  | { kind: 'ec'; hash: Hash; crv: 'P-256' | 'P-384' | 'P-521'; bytes: number }
  | { kind: 'ed25519' }

const HASHES: Record<string, { hash: Hash; bytes: number }> = {
  '256': { hash: 'SHA-256', bytes: 32 },
  '384': { hash: 'SHA-384', bytes: 48 },
  '512': { hash: 'SHA-512', bytes: 64 },
}

// ES512 is P-521, not "P-512": the curve is 521 bits, so r and s are 66 bytes each.
const EC: Record<string, { crv: 'P-256' | 'P-384' | 'P-521'; bytes: number }> = {
  '256': { crv: 'P-256', bytes: 64 },
  '384': { crv: 'P-384', bytes: 96 },
  '512': { crv: 'P-521', bytes: 132 },
}

/** Registered JWS algorithms WebCrypto has no primitive for. */
const UNAVAILABLE: Record<string, string> = {
  ES256K: 'ES256K uses the secp256k1 curve, which WebCrypto does not implement.',
  Ed448: 'Ed448 is not available in browser WebCrypto.',
}

function algSpec(alg: string): AlgSpec | string {
  const m = /^(HS|RS|PS|ES)(256|384|512)$/.exec(alg)
  if (m !== null) {
    const family = m[1]!
    const size = m[2]!
    const { hash, bytes } = HASHES[size]!
    switch (family) {
      case 'HS':
        return { kind: 'hmac', hash, bytes }
      case 'RS':
        return { kind: 'rsa', name: 'RSASSA-PKCS1-v1_5', hash, saltLength: 0 }
      case 'PS':
        // RFC 7518 §3.5: the salt is as long as the hash.
        return { kind: 'rsa', name: 'RSA-PSS', hash, saltLength: bytes }
      default:
        return { kind: 'ec', hash, ...EC[size]! }
    }
  }
  // "Ed25519" is the fully-specified name from RFC 9864 for what "EdDSA" means with an Ed25519 key.
  if (alg === 'EdDSA' || alg === 'Ed25519') return { kind: 'ed25519' }
  if (alg.startsWith('ML-DSA-')) return `${alg} is a post-quantum algorithm that browser WebCrypto does not implement yet.`
  return UNAVAILABLE[alg] ?? `"${alg}" is not a JWS signing algorithm this tool knows.`
}

function describeKey(c: KeyCandidate): string {
  switch (c.kty) {
    case 'oct':
      return 'a shared secret'
    case 'RSA':
      return 'an RSA public key'
    case 'EC':
      return c.crv === undefined ? 'an EC public key' : `an EC ${c.crv} public key`
    case 'OKP':
      return c.crv === undefined ? 'an OKP public key' : `an ${c.crv} public key`
    default:
      return `a key of type "${c.kty}"`
  }
}

function needs(spec: AlgSpec): string {
  switch (spec.kind) {
    case 'hmac':
      return 'a shared secret'
    case 'rsa':
      return 'an RSA public key'
    case 'ec':
      return `an EC ${spec.crv} public key`
    case 'ed25519':
      return 'an Ed25519 public key'
  }
}

// RFC 9864 renamed EdDSA-with-Ed25519 to "Ed25519", and exporters now write
// that into a JWK's alg (Node does). Both names mean the same signature.
const ED25519_ALGS = new Set(['EdDSA', 'Ed25519'])

interface Refusal {
  status: 'invalid' | 'error'
  reason: string
}

/**
 * The algorithm is pinned to the key, never taken on the token's word. The
 * header is attacker-controlled; the key is the one thing the verifier chose.
 */
function refusal(alg: string, spec: AlgSpec, c: KeyCandidate): Refusal | null {
  if (spec.kind === 'hmac' && c.kty !== 'oct') {
    return {
      status: 'invalid',
      reason: `Refused: ${alg} is HMAC, which takes a shared secret, but this is ${describeKey(c)}. Checking it would use the public key as the HMAC secret, and since anyone can have the public key, anyone could forge a token that passes. This is the classic algorithm-confusion attack.`,
    }
  }
  if (spec.kind !== 'hmac' && c.kty === 'oct') {
    return {
      status: 'error',
      reason: `${alg} is signed with a private key and checked with its public key, so a shared secret cannot verify it. Paste the issuer's public key as PEM or JWK.`,
    }
  }
  const wrongType =
    (spec.kind === 'rsa' && c.kty !== 'RSA') ||
    (spec.kind === 'ec' && (c.kty !== 'EC' || (c.crv !== undefined && c.crv !== spec.crv))) ||
    (spec.kind === 'ed25519' && (c.kty !== 'OKP' || c.crv !== 'Ed25519'))
  if (wrongType) {
    if (spec.kind === 'ed25519' && c.kty === 'OKP' && c.crv === 'Ed448') {
      return { status: 'error', reason: UNAVAILABLE['Ed448']! }
    }
    return { status: 'invalid', reason: `Refused: ${alg} needs ${needs(spec)}, but this is ${describeKey(c)}.` }
  }
  if (c.alg !== undefined && c.alg !== alg && !(spec.kind === 'ed25519' && ED25519_ALGS.has(c.alg))) {
    return { status: 'invalid', reason: `Refused: the key's own "alg" pins it to ${c.alg}, but the token's header says ${alg}.` }
  }
  if (c.use !== undefined && c.use !== 'sig') {
    return { status: 'invalid', reason: `Refused: the key's "use" is "${c.use}", so it is not a signing key.` }
  }
  if (c.keyOps !== undefined && !c.keyOps.includes('verify')) {
    return { status: 'invalid', reason: `Refused: the key's "key_ops" (${c.keyOps.join(', ') || 'empty'}) does not include "verify".` }
  }
  return null
}

type Outcome = { ok: boolean } | { error: string }

function importParams(spec: AlgSpec): RsaHashedImportParams | EcKeyImportParams | Algorithm {
  switch (spec.kind) {
    case 'rsa':
      return { name: spec.name, hash: spec.hash }
    case 'ec':
      return { name: 'ECDSA', namedCurve: spec.crv }
    default:
      return { name: 'Ed25519' }
  }
}

function verifyParams(spec: AlgSpec): RsaPssParams | EcdsaParams | Algorithm {
  switch (spec.kind) {
    case 'rsa':
      return spec.name === 'RSA-PSS' ? { name: 'RSA-PSS', saltLength: spec.saltLength } : { name: spec.name }
    case 'ec':
      return { name: 'ECDSA', hash: spec.hash }
    default:
      return { name: 'Ed25519' }
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function verifyWith(spec: AlgSpec, c: KeyCandidate, data: Uint8Array, sig: Uint8Array): Promise<Outcome> {
  const { source } = c
  if (source.type === 'unusable') return { error: source.message }

  if (spec.kind === 'hmac') {
    if (source.type !== 'secret') return { error: 'Not a secret.' }
    const mac = await hmac(spec.hash, source.bytes, data)
    if (!mac.ok) return { error: mac.message }
    return { ok: timingSafeEqual(mac.bytes, sig) }
  }
  if (source.type === 'secret') return { error: 'Not a public key.' }

  let key: CryptoKey
  try {
    key =
      source.type === 'jwk'
        ? await crypto.subtle.importKey('jwk', source.jwk, importParams(spec), false, ['verify'])
        : await crypto.subtle.importKey('spki', source.der as Uint8Array<ArrayBuffer>, importParams(spec), false, ['verify'])
  } catch (e) {
    // Ed25519 reached Safari in 17 and Chrome in 137; older engines throw here.
    if (e instanceof Error && e.name === 'NotSupportedError') {
      return { error: `This browser's WebCrypto cannot use ${spec.kind === 'ed25519' ? 'Ed25519' : 'this key type'}, so it cannot check the signature.` }
    }
    return { error: `The key could not be imported: ${errorText(e)}` }
  }
  try {
    const ok = await crypto.subtle.verify(
      verifyParams(spec),
      key,
      sig as Uint8Array<ArrayBuffer>,
      data as Uint8Array<ArrayBuffer>,
    )
    return { ok }
  } catch (e) {
    return { error: `Verification failed to run: ${errorText(e)}` }
  }
}

/** A signature whose length alone settles it, before any key is involved. */
function signatureShape(alg: string, spec: AlgSpec, sig: Uint8Array): string | null {
  if (sig.length === 0) return 'The signature is empty.'
  const expected = spec.kind === 'ec' ? spec.bytes : spec.kind === 'ed25519' ? 64 : null
  if (expected === null || sig.length === expected) return null
  if (spec.kind === 'ec' && isDerEcdsaSignature(sig)) {
    return `The signature is DER-encoded (an ASN.1 sequence of r and s, ${sig.length} bytes), as OpenSSL and Java produce it. JWS requires the raw ${expected}-byte r‖s form (RFC 7518 §3.4), so a compliant verifier rejects it; the issuer must convert it.`
  }
  return `${alg} signatures are ${expected} bytes, but this one is ${sig.length}.`
}

const utf8 = new TextEncoder()

const MAX_KIDS_LISTED = 8

/**
 * Verify a compact JWS against a pasted key: a JWK, a JWKS (picked by the
 * header's kid), a PEM public key or certificate, or an HS secret. The signing
 * input is the original header and payload segments exactly as pasted; they are
 * never re-encoded, since any byte of difference is a different message.
 * Never throws: every failure comes back as a result.
 */
export async function verifyJwt(token: string, key: string, options: VerifyOptions = {}): Promise<VerifyResult> {
  const parsed = parseJwt(token)
  const headerValue = parsed.header?.ok === true ? parsed.header.value : undefined
  const header = isPlainObject(headerValue) ? headerValue : null
  const alg = typeof header?.['alg'] === 'string' ? header['alg'] : null
  const format = detectKeyFormat(key)
  const result = (status: VerifyStatus, reason?: string, extra: Partial<VerifyResult> = {}): VerifyResult => {
    const r: VerifyResult = { status, alg, format, ...extra }
    if (reason !== undefined) r.reason = reason
    return r
  }

  if (parsed.token === '') return result('error', 'No token.')
  if (parsed.kind === 'jwe') {
    return result('error', 'This is an encrypted token (JWE). It has no signature to check, and decrypting it needs the recipient’s private key.')
  }
  if (parsed.kind === null) return result('error', parsed.errors[0]?.message ?? 'Not a JWT.')
  if (header === null) return result('error', 'The header is not a readable JSON object, so the algorithm is unknown.')
  if (alg === null) return result('error', 'The header has no "alg", so there is no algorithm to verify with.')

  if (alg.toLowerCase() === 'none') {
    return result('invalid', `Refused: "alg" is "${alg}", which means unsigned. There is nothing to verify, and a verifier that accepts it lets anyone forge a token.`)
  }
  if (header['crit'] !== undefined) {
    // RFC 7515 §4.1.11: a verifier MUST reject what it does not understand. b64
    // (RFC 7797) in particular changes the signing input itself.
    return result('error', `The header lists critical extensions in "crit" (${JSON.stringify(header['crit'])}), which this tool does not implement, and RFC 7515 says to reject the token rather than guess.`)
  }

  const [headerPart, payloadPart, sigPart] = parsed.parts
  if (payloadPart!.text === '') {
    return result('error', 'The payload segment is empty: this is a detached-payload JWS (RFC 7515 Appendix F), and the content it signs is not in the token.')
  }
  if (parsed.signature === null) {
    return result('error', parsed.errors.find((e) => e.segment === 'signature')?.message ?? 'The signature is not base64url.')
  }

  const spec = algSpec(alg)
  if (typeof spec === 'string') return result('error', spec)

  const parsedKey = parseKey(key, options.secretEncoding ?? 'text')
  if (!parsedKey.ok) return result('error', parsedKey.message)

  let sig: Uint8Array
  try {
    sig = base64ToBytes(sigPart!.text.replace(/=+$/, ''), { alphabet: 'base64url', lenient: true })
  } catch (e) {
    return result('error', `The signature is not base64url: ${errorText(e)}`)
  }
  const shape = signatureShape(alg, spec, sig)
  if (shape !== null) return result('invalid', shape)

  // Select by kid in a set; a single key is used whatever its kid, as every
  // library does when it is handed one key.
  const headerKid = typeof header['kid'] === 'string' ? header['kid'] : undefined
  let pool = parsedKey.candidates
  if (format === 'jwks' && headerKid !== undefined) {
    pool = pool.filter((c) => c.kid === headerKid)
    if (pool.length === 0) {
      const kids = parsedKey.candidates.flatMap((c) => (c.kid === undefined ? [] : [JSON.stringify(c.kid)]))
      const listed = kids.length === 0 ? 'None of its keys has a kid.' : `Its kids: ${kids.slice(0, MAX_KIDS_LISTED).join(', ')}${kids.length > MAX_KIDS_LISTED ? ', …' : ''}.`
      return result('error', `No key in the set has the header's kid ${JSON.stringify(headerKid)}. ${listed}`)
    }
  }

  const refusals: Refusal[] = []
  const usable: KeyCandidate[] = []
  for (const c of pool) {
    // An unreadable key is reported as such before any algorithm judgement.
    const r = c.source.type === 'unusable' ? { status: 'error' as const, reason: c.source.message } : refusal(alg, spec, c)
    if (r !== null) refusals.push(r)
    else usable.push(c)
  }

  const idOf = (c: KeyCandidate): Partial<VerifyResult> => {
    const extra: Partial<VerifyResult> = {}
    if (c.kid !== undefined) extra.keyId = c.kid
    if (c.index !== undefined) extra.keyIndex = c.index
    return extra
  }
  const notes = [...parsedKey.notes]

  if (usable.length === 0) {
    const first = refusals[0]!
    if (pool.length === 1) return result(first.status, first.reason, idOf(pool[0]!))
    return result(first.status, `None of the ${pool.length} keys in the set can verify ${alg}. The first: ${first.reason}`)
  }

  const data = utf8.encode(`${headerPart!.text}.${payloadPart!.text}`)
  const outcomes = await Promise.all(usable.map((c) => verifyWith(spec, c, data, sig)))
  const hit = outcomes.findIndex((o) => 'ok' in o && o.ok)

  if (hit >= 0) {
    const c = usable[hit]!
    if (usable.length > 1) {
      const why = headerKid === undefined ? 'The header has no kid, so' : `${usable.length} keys share the kid, so`
      notes.unshift(`${why} all ${usable.length} keys that fit ${alg} were tried; key ${c.index! + 1} in the set matched.`)
    }
    if (spec.kind === 'hmac' && c.source.type === 'secret' && c.source.bytes.length < spec.bytes) {
      notes.push(`The secret is ${c.source.bytes.length} bytes, shorter than the ${spec.bytes} RFC 7518 requires for ${alg}. Strict libraries refuse it, and a short secret can be brute-forced offline from any token.`)
    }
    return result('valid', notes.length > 0 ? notes.join(' ') : undefined, idOf(c))
  }

  const errors = outcomes.flatMap((o) => ('error' in o ? [o.error] : []))
  if (errors.length === outcomes.length) {
    return result('error', errors[0], usable.length === 1 ? idOf(usable[0]!) : {})
  }

  const hints: string[] = []
  if (usable.length === 1) {
    const c = usable[0]!
    hints.push('The signature does not match this key.')
    if (spec.kind === 'hmac' && sig.length !== spec.bytes) {
      hints.push(`An ${alg} signature is ${spec.bytes} bytes, and this one is ${sig.length}, so it was not made with ${alg}.`)
    } else if (format === 'secret' && key !== key.trim()) {
      hints.push('The secret starts or ends with whitespace, which counts as part of it.')
    } else if (format === 'secret' && (options.secretEncoding ?? 'text') === 'text' && /^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(key)) {
      hints.push('If the secret is base64-encoded, set its encoding to Base64 or Base64url.')
    }
    if (headerKid !== undefined && c.kid !== undefined && c.kid !== headerKid) {
      hints.push(`The token's kid is ${JSON.stringify(headerKid)} but this key's is ${JSON.stringify(c.kid)}: probably the wrong key.`)
    }
    return result('invalid', [...hints, ...notes].join(' '), idOf(c))
  }
  return result('invalid', [`The signature matches none of the ${usable.length} keys in the set that fit ${alg}.`, ...notes].join(' '))
}
