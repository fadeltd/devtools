import { base64ToBytes } from '../base64/codec.ts'
import { parseBase64 } from '../hash/bytes.ts'
import { decodeKey } from '../hash/hmac.ts'
import { certificateSpki, pkcs1ToSpki, spkiAlgorithm } from './der.ts'
import { isPlainObject } from './parse.ts'

export type KeyFormat = 'jwk' | 'jwks' | 'pem' | 'secret'
export type SecretEncoding = 'text' | 'base64' | 'base64url'

/** Where the bytes WebCrypto imports come from. */
export type KeySource =
  | { type: 'jwk'; jwk: JsonWebKey }
  | { type: 'spki'; der: Uint8Array }
  | { type: 'secret'; bytes: Uint8Array }
  /** A key in a set that cannot be used. Kept, so a kid match can say why. */
  | { type: 'unusable'; message: string }

export interface KeyCandidate {
  /** JWK key type: 'RSA', 'EC', 'OKP' or 'oct', or whatever an unknown key says. */
  kty: string
  crv?: string
  kid?: string
  /** The JWK's own `alg`, `use` and `key_ops`, which restrict what it may verify. */
  alg?: string
  use?: string
  keyOps?: string[]
  /** Position in a JWKS. */
  index?: number
  source: KeySource
}

export type ParsedKey =
  | { ok: true; format: KeyFormat; candidates: KeyCandidate[]; notes: string[] }
  | { ok: false; format: KeyFormat | null; message: string }

/**
 * What a pasted key looks like. Anything starting with `{` is JSON, even when
 * it does not parse yet, so a half-typed JWK reports a JSON error instead of
 * being quietly used as an HMAC secret.
 */
export function detectKeyFormat(input: string): KeyFormat | null {
  const s = input.trim()
  if (s === '') return null
  if (s.startsWith('{')) {
    try {
      const v: unknown = JSON.parse(s)
      if (isPlainObject(v) && Array.isArray(v['keys'])) return 'jwks'
    } catch {
      // Falls through to 'jwk'; parseKey reports the JSON error.
    }
    return 'jwk'
  }
  if (s.includes('-----BEGIN ')) return 'pem'
  return 'secret'
}

const OPENSSL_PUBKEY_HINT = 'Extract the public key with `openssl x509 -pubkey -noout -in cert.pem` and paste that.'

const EC_CURVES: Record<string, string> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.3.132.0.10': 'secp256k1',
}

const OKP_CURVES: Record<string, string> = {
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
}

/** Name the key inside an SPKI by its algorithm OID, so the alg check can run before import. */
function spkiCandidate(der: Uint8Array): KeyCandidate {
  const alg = spkiAlgorithm(der)
  if (alg === null) {
    return { kty: 'unknown', source: { type: 'unusable', message: 'The public key is not a well-formed SubjectPublicKeyInfo.' } }
  }
  const source: KeySource = { type: 'spki', der }
  if (alg.oid === '1.2.840.113549.1.1.1') return { kty: 'RSA', source }
  if (alg.oid === '1.2.840.113549.1.1.10') {
    return {
      kty: 'RSA',
      source: {
        type: 'unusable',
        message:
          'This is an RSASSA-PSS-only public key (OID id-RSASSA-PSS), which browsers cannot import. Re-export it as a plain RSA key (rsaEncryption), or paste it as a JWK.',
      },
    }
  }
  if (alg.oid === '1.2.840.10045.2.1') {
    const crv = alg.param === undefined ? undefined : (EC_CURVES[alg.param] ?? alg.param)
    return crv === undefined ? { kty: 'EC', source } : { kty: 'EC', crv, source }
  }
  const okp = OKP_CURVES[alg.oid]
  if (okp !== undefined) return { kty: 'OKP', crv: okp, source }
  return { kty: 'unknown', source: { type: 'unusable', message: `The public key's algorithm (OID ${alg.oid}) is not one JWS signs with.` } }
}

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/

const pemFail = (message: string): ParsedKey => ({ ok: false, format: 'pem', message })

function parsePem(input: string): ParsedKey {
  const m = PEM_BLOCK.exec(input)
  if (m === null) return pemFail('The PEM has a BEGIN line but no matching END line.')
  const label = m[1]!

  if (label.includes('PRIVATE KEY')) {
    return pemFail(
      'This is a private key. Verifying needs only the public half: run `openssl pkey -in key.pem -pubout` and paste the result. A private key lets its holder sign tokens, so it is best kept out of every web page, even one that sends nothing.',
    )
  }

  // RFC 1421 header lines (Proc-Type, DEK-Info) carry a colon; base64 never does.
  const body = m[2]!
    .split('\n')
    .filter((line) => !line.includes(':'))
    .join('')
  const decoded = parseBase64(body)
  if (!decoded.ok) return pemFail(`The PEM body is not valid base64: ${decoded.message}`)
  const der = decoded.bytes

  let spki: Uint8Array | null
  const notes: string[] = []
  switch (label) {
    case 'PUBLIC KEY':
      spki = der
      break
    case 'RSA PUBLIC KEY':
      spki = pkcs1ToSpki(der)
      if (spki === null) return pemFail('This RSA PUBLIC KEY is not a well-formed PKCS#1 key.')
      break
    case 'CERTIFICATE':
    case 'X509 CERTIFICATE':
    case 'TRUSTED CERTIFICATE':
      spki = certificateSpki(der)
      if (spki === null) return pemFail(`Could not find the public key inside this certificate. ${OPENSSL_PUBKEY_HINT}`)
      // A chain is leaf first, and the leaf is the one that signed.
      if (input.indexOf('-----BEGIN', m.index + m[0].length) >= 0) {
        notes.push('Only the first certificate in the chain was used.')
      }
      break
    default:
      return pemFail(`A "${label}" PEM block is not a public key. Paste a PUBLIC KEY, RSA PUBLIC KEY or CERTIFICATE.`)
  }
  return { ok: true, format: 'pem', candidates: [spkiCandidate(spki)], notes }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const B64URL = /^[A-Za-z0-9_-]*$/

function decodeB64url(s: string): Uint8Array | null {
  if (!B64URL.test(s) || s.length % 4 === 1) return null
  try {
    return base64ToBytes(s, { alphabet: 'base64url', lenient: true })
  } catch {
    return null
  }
}

/**
 * Copy only the public members, so a pasted private JWK still verifies (WebCrypto
 * will not give a private key the 'verify' usage), and so `alg`, `use` and
 * `key_ops`, which are checked here with better messages, do not trip import.
 */
function publicJwk(v: Record<string, unknown>, members: readonly string[]): JsonWebKey | string {
  const out: Record<string, string> = {}
  for (const name of ['kty', ...members]) {
    const value = str(v[name])
    if (value === undefined) return `"${name}" is missing or not a string.`
    out[name] = value
  }
  return out as JsonWebKey
}

function jwkCandidate(v: unknown, index: number | undefined): { candidate: KeyCandidate; private: boolean } {
  const base = (kty: string): KeyCandidate => {
    const c: KeyCandidate = { kty, source: { type: 'unusable', message: '' } }
    if (!isPlainObject(v)) return c
    const kid = str(v['kid'])
    const alg = str(v['alg'])
    const use = str(v['use'])
    if (kid !== undefined) c.kid = kid
    if (alg !== undefined) c.alg = alg
    if (use !== undefined) c.use = use
    // A private JWK's key_ops say "sign"; its public half, which is all that is
    // used, is for "verify". So they only restrict a public key.
    if (Array.isArray(v['key_ops']) && v['d'] === undefined) c.keyOps = v['key_ops'].filter((x): x is string => typeof x === 'string')
    if (index !== undefined) c.index = index
    return c
  }
  const unusable = (kty: string, message: string) => {
    const c = base(kty)
    c.source = { type: 'unusable', message }
    return { candidate: c, private: false }
  }

  if (!isPlainObject(v)) return unusable('unknown', 'A JWK must be a JSON object.')
  const kty = str(v['kty'])
  if (kty === undefined) return unusable('unknown', 'The JWK has no "kty", so its key type is unknown.')
  const c = base(kty)
  const isPrivate = v['d'] !== undefined

  const fromJwk = (members: readonly string[]) => {
    const jwk = publicJwk(v, members)
    c.source = typeof jwk === 'string' ? { type: 'unusable', message: `This ${kty} JWK is incomplete: ${jwk}` } : { type: 'jwk', jwk }
  }

  switch (kty) {
    case 'RSA':
    case 'EC': {
      if (kty === 'EC' && str(v['crv']) !== undefined) c.crv = str(v['crv'])!
      const members = kty === 'RSA' ? ['n', 'e'] : ['crv', 'x', 'y']
      // Some JWKS (Azure AD, older Auth0) carry the certificate as well; it is
      // enough on its own when the raw members are absent.
      const x5c = Array.isArray(v['x5c']) ? str(v['x5c'][0]) : undefined
      if (x5c !== undefined && v[members[0]!] === undefined) {
        const der = parseBase64(x5c)
        const spki = der.ok ? certificateSpki(der.bytes) : null
        c.source = spki === null ? { type: 'unusable', message: `The JWK's x5c certificate could not be read. ${OPENSSL_PUBKEY_HINT}` } : { type: 'spki', der: spki }
      } else {
        fromJwk(members)
      }
      break
    }
    case 'OKP':
      if (str(v['crv']) !== undefined) c.crv = str(v['crv'])!
      fromJwk(['crv', 'x'])
      break
    case 'oct': {
      const k = str(v['k'])
      const bytes = k === undefined ? null : decodeB64url(k)
      c.source = bytes === null ? { type: 'unusable', message: 'The oct JWK\'s "k" is missing or is not base64url.' } : { type: 'secret', bytes }
      break
    }
    default:
      c.source = { type: 'unusable', message: `"kty": "${kty}" is not a key type JWS signs with.` }
  }
  return { candidate: c, private: isPrivate && kty !== 'oct' }
}

const PRIVATE_NOTE =
  'The JWK includes private members ("d"); only the public part was used. A private key lets its holder sign tokens, so keep it out of places it can leak.'

function parseJson(input: string): ParsedKey {
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch (e) {
    return { ok: false, format: 'jwk', message: `The key is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (isPlainObject(value) && Array.isArray(value['keys'])) {
    const found = value['keys'].map((k, i) => jwkCandidate(k, i))
    if (found.length === 0) return { ok: false, format: 'jwks', message: 'The key set is empty.' }
    const notes = found.some((f) => f.private) ? [PRIVATE_NOTE] : []
    return { ok: true, format: 'jwks', candidates: found.map((f) => f.candidate), notes }
  }
  const one = jwkCandidate(value, undefined)
  return { ok: true, format: 'jwk', candidates: [one.candidate], notes: one.private ? [PRIVATE_NOTE] : [] }
}

const secretFail = (message: string): ParsedKey => ({ ok: false, format: 'secret', message })

function parseSecret(input: string, encoding: SecretEncoding): ParsedKey {
  if (encoding === 'base64url') {
    // decodeKey's base64 takes either alphabet. A secret declared base64url
    // that holds + or / is really standard base64, and saying so beats
    // guessing.
    const bad = /[+/]/.exec(input)
    if (bad !== null) return secretFail(`"${bad[0]}" (position ${bad.index + 1}) is not base64url. Choose Base64 if the secret uses + and /.`)
  }
  // Never trimmed: a secret is exact bytes, as in the HMAC tool.
  const decoded = decodeKey(input, encoding === 'text' ? 'text' : 'base64')
  if (!decoded.ok) return secretFail(`The secret is not valid ${encoding}: ${decoded.message}`)
  return { ok: true, format: 'secret', candidates: [{ kty: 'oct', source: { type: 'secret', bytes: decoded.bytes } }], notes: [] }
}

/** Turn a pasted key into importable candidates. Never throws. */
export function parseKey(input: string, secretEncoding: SecretEncoding = 'text'): ParsedKey {
  const format = detectKeyFormat(input)
  switch (format) {
    case null:
      return { ok: false, format: null, message: 'No key.' }
    case 'jwk':
    case 'jwks':
      return parseJson(input.trim())
    case 'pem':
      return parsePem(input)
    case 'secret':
      return parseSecret(input, secretEncoding)
  }
}
