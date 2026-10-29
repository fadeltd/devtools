import { X509Certificate, createPublicKey } from 'node:crypto'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bytesToBase64, wrap } from '../base64/codec.ts'
import { certificateSpki, isDerEcdsaSignature, pkcs1ToSpki, readTlv, spkiAlgorithm } from './der.ts'
import { encodeJsonSegment as seg } from './example.ts'
import { detectKeyFormat } from './keys.ts'
import { verifyJwt, type VerifyResult } from './verify.ts'

const utf8 = (s: string) => new TextEncoder().encode(s)
const b64url = (bytes: Uint8Array) => bytesToBase64(bytes, { alphabet: 'base64url', padding: false })
const b64 = (bytes: Uint8Array) => bytesToBase64(bytes, { alphabet: 'base64', padding: true })
const pem = (der: Uint8Array, label: string) => `-----BEGIN ${label}-----\n${wrap(b64(der), 64)}\n-----END ${label}-----\n`

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((p) => [...p]))
}

/** An independent DER encoder, so the fixtures do not lean on the code under test. */
function tlv(tag: number, ...parts: (Uint8Array | number[])[]): Uint8Array {
  const body = concat(...parts)
  const n = body.length
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]
  return concat([tag], len, body)
}

/** Raw r‖s to the ASN.1 form OpenSSL emits. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    const v = b.slice(i)
    return tlv(0x02, v[0]! & 0x80 ? concat([0], v) : v)
  }
  const half = raw.length / 2
  return tlv(0x30, int(raw.slice(0, half)), int(raw.slice(half)))
}

const flip = (bytes: Uint8Array, at = 0) => {
  const out = bytes.slice()
  out[at]! ^= 0x01
  return out
}

const PAYLOAD = { sub: 'user_1234', iat: 1767225600, exp: 1767229200 }

async function sign(
  header: Record<string, unknown>,
  key: CryptoKey,
  params: AlgorithmIdentifier | RsaPssParams | EcdsaParams,
): Promise<{ input: string; sig: Uint8Array }> {
  const input = `${seg(header)}.${seg(PAYLOAD)}`
  const sig = new Uint8Array(await crypto.subtle.sign(params, key, utf8(input)))
  return { input, sig }
}

const token = (input: string, sig: Uint8Array) => `${input}.${b64url(sig)}`

async function publicForms(key: CryptoKey): Promise<{ jwk: string; spki: Uint8Array; pem: string }> {
  const jwk = await crypto.subtle.exportKey('jwk', key)
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', key))
  return { jwk: JSON.stringify(jwk), spki, pem: pem(spki, 'PUBLIC KEY') }
}

const RSA_GEN = { modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1) }

const CASES = [
  {
    alg: 'RS256',
    gen: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', ...RSA_GEN },
    params: { name: 'RSASSA-PKCS1-v1_5' },
  },
  { alg: 'PS256', gen: { name: 'RSA-PSS', hash: 'SHA-256', ...RSA_GEN }, params: { name: 'RSA-PSS', saltLength: 32 } },
  { alg: 'ES256', gen: { name: 'ECDSA', namedCurve: 'P-256' }, params: { name: 'ECDSA', hash: 'SHA-256' } },
  { alg: 'ES384', gen: { name: 'ECDSA', namedCurve: 'P-384' }, params: { name: 'ECDSA', hash: 'SHA-384' } },
  { alg: 'EdDSA', gen: { name: 'Ed25519' }, params: { name: 'Ed25519' } },
] as const

async function pair(gen: (typeof CASES)[number]['gen']): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(gen, true, ['sign', 'verify'])) as CryptoKeyPair
}

const expectStatus = (r: VerifyResult, status: VerifyResult['status'], reason?: RegExp) => {
  expect(r.status, r.reason).toBe(status)
  if (reason !== undefined) expect(r.reason).toMatch(reason)
}

describe('RFC 7515 Appendix A.1 (HS256)', () => {
  // The header contains a CR LF, so re-encoding the decoded JSON would change
  // the signing input. Only the original segments verify.
  const TOKEN =
    'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9' +
    '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ' +
    '.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const K = 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow'

  it('verifies with the RFC JWK', async () => {
    const r = await verifyJwt(TOKEN, JSON.stringify({ kty: 'oct', k: K }))
    expect(r).toEqual({ status: 'valid', alg: 'HS256', format: 'jwk' })
  })

  it('verifies with the secret pasted as base64url, and as base64', async () => {
    expectStatus(await verifyJwt(TOKEN, K, { secretEncoding: 'base64url' }), 'valid')
    expectStatus(await verifyJwt(TOKEN, K, { secretEncoding: 'base64' }), 'valid')
  })

  it('accepts the token with a Bearer prefix', async () => {
    expectStatus(await verifyJwt(`Bearer ${TOKEN}`, K, { secretEncoding: 'base64url' }), 'valid')
  })

  it('fails with the secret read as text, and suggests the encoding', async () => {
    const r = await verifyJwt(TOKEN, K)
    expectStatus(r, 'invalid', /Base64/)
    expect(r.format).toBe('secret')
  })

  it('fails when the payload is changed', async () => {
    const [h, , s] = TOKEN.split('.')
    expectStatus(await verifyJwt(`${h}.${seg({ iss: 'joe' })}.${s}`, K, { secretEncoding: 'base64url' }), 'invalid')
  })

  it('says when the secret has surrounding whitespace', async () => {
    const input = `${seg({ alg: 'HS256' })}.${seg(PAYLOAD)}`
    const key = await crypto.subtle.importKey('raw', utf8('a-long-enough-secret-for-hs256!!'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(input)))
    expectStatus(await verifyJwt(token(input, sig), 'a-long-enough-secret-for-hs256!!'), 'valid')
    expectStatus(await verifyJwt(token(input, sig), 'a-long-enough-secret-for-hs256!!\n'), 'invalid', /whitespace/)
  })

  it('warns about a short HMAC secret on a valid result', async () => {
    const input = `${seg({ alg: 'HS256' })}.${seg(PAYLOAD)}`
    const key = await crypto.subtle.importKey('raw', utf8('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(input)))
    expectStatus(await verifyJwt(token(input, sig), 'secret'), 'valid', /6 bytes, shorter than the 32/)
  })

  it('rejects base64 characters in a base64url secret', async () => {
    expectStatus(await verifyJwt(TOKEN, 'ab+c', { secretEncoding: 'base64url' }), 'error', /not base64url/)
  })
})

describe.each(CASES)('$alg', ({ alg, gen, params }) => {
  it('verifies with JWK and PEM, and rejects a flipped byte and a wrong key', async () => {
    const [mine, other] = await Promise.all([pair(gen), pair(gen)])
    const { input, sig } = await sign({ alg, typ: 'JWT' }, mine.privateKey, params)
    const { jwk, pem: pemKey } = await publicForms(mine.publicKey)
    const wrong = await publicForms(other.publicKey)

    expect(await verifyJwt(token(input, sig), jwk)).toEqual({ status: 'valid', alg, format: 'jwk' })
    expect(await verifyJwt(token(input, sig), pemKey)).toEqual({ status: 'valid', alg, format: 'pem' })

    expectStatus(await verifyJwt(token(input, flip(sig, 10)), jwk), 'invalid', /does not match/)
    expectStatus(await verifyJwt(token(input, flip(sig, 10)), pemKey), 'invalid')
    expectStatus(await verifyJwt(token(input, sig), wrong.jwk), 'invalid', /does not match/)
    expectStatus(await verifyJwt(token(input, sig), wrong.pem), 'invalid')
  })
})

describe('key wrappers', () => {
  it('reads a PKCS#1 RSA PUBLIC KEY', async () => {
    const kp = await pair(CASES[0].gen)
    const { input, sig } = await sign({ alg: 'RS256' }, kp.privateKey, CASES[0].params)
    const { spki } = await publicForms(kp.publicKey)
    // node:crypto is an independent encoder for the PKCS#1 fixture.
    const pkcs1 = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' }).export({ type: 'pkcs1', format: 'pem' })
    expect(pkcs1).toMatch(/BEGIN RSA PUBLIC KEY/)
    expectStatus(await verifyJwt(token(input, sig), String(pkcs1)), 'valid')
  })

  it('wraps PKCS#1 into the same SPKI WebCrypto exports', async () => {
    const kp = await pair(CASES[0].gen)
    const { spki } = await publicForms(kp.publicKey)
    const pkcs1 = createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' }).export({ type: 'pkcs1', format: 'der' })
    expect(pkcs1ToSpki(new Uint8Array(pkcs1))).toEqual(spki)
  })

  describe('X.509 certificate', () => {
    const oid = (...bytes: number[]) => tlv(0x06, bytes)
    const name = tlv(0x30, tlv(0x31, tlv(0x30, oid(0x55, 0x04, 0x03), tlv(0x0c, utf8('devtools test')))))
    const sigAlg = tlv(0x30, oid(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02))
    const validity = tlv(0x30, tlv(0x17, utf8('260101000000Z')), tlv(0x17, utf8('360101000000Z')))
    const certificate = (spki: Uint8Array, version = true) =>
      tlv(
        0x30,
        tlv(0x30, version ? tlv(0xa0, tlv(0x02, [2])) : [], tlv(0x02, [0x01, 0x23]), sigAlg, name, validity, name, spki),
        sigAlg,
        tlv(0x03, [0], new Uint8Array(64)),
      )

    it('finds the SPKI, agreeing with node:crypto', async () => {
      const kp = await pair(CASES[2].gen)
      const { spki } = await publicForms(kp.publicKey)
      const der = certificate(spki)
      const x509 = new X509Certificate(Buffer.from(der))
      expect(new Uint8Array(x509.publicKey.export({ type: 'spki', format: 'der' }))).toEqual(spki)
      expect(certificateSpki(der)).toEqual(spki)
      expect(certificateSpki(certificate(spki, false))).toEqual(spki)
    })

    it('verifies through a certificate, using the first of a chain', async () => {
      const [kp, other] = await Promise.all([pair(CASES[2].gen), pair(CASES[2].gen)])
      const { input, sig } = await sign({ alg: 'ES256' }, kp.privateKey, CASES[2].params)
      const chain = pem(certificate((await publicForms(kp.publicKey)).spki), 'CERTIFICATE') + pem(certificate((await publicForms(other.publicKey)).spki), 'CERTIFICATE')
      expectStatus(await verifyJwt(token(input, sig), chain), 'valid', /first certificate/)
    })

    it('reads a JWK that carries only x5c', async () => {
      const kp = await pair(CASES[2].gen)
      const { input, sig } = await sign({ alg: 'ES256' }, kp.privateKey, CASES[2].params)
      const x5c = b64(certificate((await publicForms(kp.publicKey)).spki))
      expectStatus(await verifyJwt(token(input, sig), JSON.stringify({ kty: 'EC', x5c: [x5c] })), 'valid')
    })

    it('rejects a truncated or garbage certificate with the openssl hint', async () => {
      const kp = await pair(CASES[2].gen)
      const der = certificate((await publicForms(kp.publicKey)).spki)
      expect(certificateSpki(der.slice(0, 40))).toBeNull()
      expect(certificateSpki(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x00]))).toBeNull()
      const { input, sig } = await sign({ alg: 'ES256' }, kp.privateKey, CASES[2].params)
      expectStatus(await verifyJwt(token(input, sig), pem(der.slice(0, 40), 'CERTIFICATE')), 'error', /openssl x509 -pubkey -noout/)
    })
  })

  it('refuses a private key PEM with the openssl hint', async () => {
    const r = await verifyJwt(`${seg({ alg: 'RS256' })}.${seg({})}.AAAA`, pem(new Uint8Array(32), 'PRIVATE KEY'))
    expectStatus(r, 'error', /private key.*openssl pkey/)
  })

  it('uses only the public half of a private JWK, and says so', async () => {
    const kp = await pair(CASES[2].gen)
    const { input, sig } = await sign({ alg: 'ES256' }, kp.privateKey, CASES[2].params)
    const priv = await crypto.subtle.exportKey('jwk', kp.privateKey)
    expect(priv.d).toBeDefined()
    expectStatus(await verifyJwt(token(input, sig), JSON.stringify(priv)), 'valid', /private members/)
  })
})

/** Two RSA keys; the token is signed by the second. */
async function setupJwks(header: Record<string, unknown>) {
  const [a, b] = await Promise.all([pair(CASES[0].gen), pair(CASES[0].gen)])
  const { input, sig } = await sign({ alg: 'RS256', ...header }, b.privateKey, CASES[0].params)
  const ja = await crypto.subtle.exportKey('jwk', a.publicKey)
  const jb = await crypto.subtle.exportKey('jwk', b.publicKey)
  return { tok: token(input, sig), ja, jb }
}

describe('JWKS', () => {
  it('picks the key by kid', async () => {
    const { tok, ja, jb } = await setupJwks({ kid: 'b' })
    const set = JSON.stringify({ keys: [{ ...ja, kid: 'a' }, { ...jb, kid: 'b' }] })
    expect(await verifyJwt(tok, set)).toEqual({ status: 'valid', alg: 'RS256', format: 'jwks', keyId: 'b', keyIndex: 1 })
  })

  it('does not fall back to other keys when the kid names the wrong one', async () => {
    const { tok, ja, jb } = await setupJwks({ kid: 'a' })
    const set = JSON.stringify({ keys: [{ ...ja, kid: 'a' }, { ...jb, kid: 'b' }] })
    expect(await verifyJwt(tok, set)).toMatchObject({ status: 'invalid', keyId: 'a', keyIndex: 0 })
  })

  it('reports an unknown kid and lists the ones there are', async () => {
    const { tok, ja, jb } = await setupJwks({ kid: 'zzz' })
    const set = JSON.stringify({ keys: [{ ...ja, kid: 'a' }, { ...jb, kid: 'b' }] })
    expectStatus(await verifyJwt(tok, set), 'error', /kid "zzz".*"a", "b"/)
  })

  it('without a kid, tries every compatible key and reports which matched', async () => {
    const { tok, ja, jb } = await setupJwks({})
    const ec = await crypto.subtle.exportKey('jwk', (await pair(CASES[2].gen)).publicKey)
    const set = JSON.stringify({ keys: [ec, ja, { kty: 'RSA', n: 'broken' }, jb] })
    const r = await verifyJwt(tok, set)
    expect(r).toMatchObject({ status: 'valid', keyIndex: 3 })
    expect(r.reason).toMatch(/no kid.*key 4 in the set matched/)
  })

  it('without a kid, is invalid when no key matches', async () => {
    const { tok, ja } = await setupJwks({})
    expectStatus(await verifyJwt(tok, JSON.stringify({ keys: [ja, ja] })), 'invalid', /none of the 2 keys/)
  })

  it('says why when no key in the set fits the algorithm', async () => {
    const { tok } = await setupJwks({})
    const ec = await crypto.subtle.exportKey('jwk', (await pair(CASES[2].gen)).publicKey)
    expectStatus(await verifyJwt(tok, JSON.stringify({ keys: [ec, ec] })), 'invalid', /None of the 2 keys.*RS256 needs an RSA public key/)
  })

  it('reports an empty set', async () => {
    const { tok } = await setupJwks({})
    expectStatus(await verifyJwt(tok, '{"keys":[]}'), 'error', /empty/)
  })
})

describe('refusals', () => {
  it('refuses HS256 with an RSA public key: algorithm confusion', async () => {
    const kp = await pair(CASES[0].gen)
    const { pem: pemKey, jwk } = await publicForms(kp.publicKey)
    // The real attack: HMAC the token with the public key's PEM text as the secret.
    const input = `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg(PAYLOAD)}`
    const hmacKey = await crypto.subtle.importKey('raw', utf8(pemKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const forged = token(input, new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, utf8(input))))

    expectStatus(await verifyJwt(forged, pemKey), 'invalid', /Refused.*algorithm-confusion/)
    expectStatus(await verifyJwt(forged, jwk), 'invalid', /Refused.*RSA public key/)
  })

  it.each(['none', 'None', 'NONE'])('refuses alg "%s"', async (alg) => {
    const r = await verifyJwt(`${seg({ alg })}.${seg(PAYLOAD)}.`, 'secret')
    expectStatus(r, 'invalid', /Refused.*unsigned/)
    expect(r.alg).toBe(alg)
  })

  it('cannot verify RS256 with a shared secret', async () => {
    expectStatus(await verifyJwt(`${seg({ alg: 'RS256' })}.${seg(PAYLOAD)}.${b64url(new Uint8Array(256))}`, 'secret'), 'error', /public key/)
  })

  it('refuses ES256 with a P-384 key', async () => {
    const kp = await pair(CASES[2].gen)
    const { input, sig } = await sign({ alg: 'ES256' }, kp.privateKey, CASES[2].params)
    const p384 = (await publicForms((await pair(CASES[3].gen)).publicKey)).pem
    expectStatus(await verifyJwt(token(input, sig), p384), 'invalid', /EC P-256.*EC P-384/)
  })

  it('refuses a JWK whose alg, use or key_ops conflicts with the token', async () => {
    const kp = await pair(CASES[0].gen)
    const { input, sig } = await sign({ alg: 'RS256' }, kp.privateKey, CASES[0].params)
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey)
    const tok = token(input, sig)
    expectStatus(await verifyJwt(tok, JSON.stringify({ ...jwk, alg: 'PS256' })), 'invalid', /pins it to PS256/)
    expectStatus(await verifyJwt(tok, JSON.stringify({ ...jwk, alg: undefined, use: 'enc' })), 'invalid', /"use" is "enc"/)
    expectStatus(await verifyJwt(tok, JSON.stringify({ ...jwk, alg: undefined, key_ops: ['encrypt'] })), 'invalid', /key_ops/)
    expectStatus(await verifyJwt(tok, JSON.stringify({ ...jwk, alg: 'RS256', use: 'sig', key_ops: ['verify'] })), 'valid')
  })

  it('reports a DER-encoded ECDSA signature as such', async () => {
    const kp = await pair(CASES[2].gen)
    const { input, sig } = await sign({ alg: 'ES256' }, kp.privateKey, CASES[2].params)
    const der = rawToDer(sig)
    expect(isDerEcdsaSignature(der)).toBe(true)
    expect(isDerEcdsaSignature(sig)).toBe(false)
    const { jwk } = await publicForms(kp.publicKey)
    expectStatus(await verifyJwt(token(input, der), jwk), 'invalid', /DER-encoded.*64-byte r‖s/)
  })

  it('reports a wrong-length ECDSA signature that is not DER', async () => {
    const tok = `${seg({ alg: 'ES384' })}.${seg(PAYLOAD)}.${b64url(new Uint8Array(64))}`
    expectStatus(await verifyJwt(tok, 'x'), 'invalid', /ES384 signatures are 96 bytes, but this one is 64/)
  })
})

describe('errors come back as data', () => {
  const HS = `${seg({ alg: 'HS256' })}.${seg(PAYLOAD)}.${b64url(new Uint8Array(32))}`

  it.each([
    ['an empty token', '', 'k', /No token/],
    ['a JWE', `${seg({ alg: 'dir', enc: 'A128GCM' })}..AAAA.AAAA.AAAA`, 'k', /encrypted/],
    ['two segments', 'abc.def', 'k', /found 2/],
    ['no alg', `${seg({ typ: 'JWT' })}.${seg({})}.AAAA`, 'k', /no "alg"/],
    ['an unknown alg', `${seg({ alg: 'XS256' })}.${seg({})}.AAAA`, 'k', /not a JWS signing algorithm/],
    ['ES256K', `${seg({ alg: 'ES256K' })}.${seg({})}.AAAA`, 'k', /secp256k1/],
    ['crit', `${seg({ alg: 'HS256', crit: ['b64'], b64: false })}.${seg({})}.AAAA`, 'k', /crit/],
    ['a detached payload', `${seg({ alg: 'HS256' })}..AAAA`, 'k', /detached/],
    ['a bad signature segment', `${seg({ alg: 'HS256' })}.${seg({})}.AA+A`, 'k', /not a base64url/],
    ['half-typed JSON', HS, '{"kty":"oct"', /not valid JSON/],
    ['a JWK without kty', HS, '{"k":"AAAA"}', /no "kty"/],
    ['an unfinished PEM', HS, '-----BEGIN PUBLIC KEY-----\nAAAA', /no matching END/],
    ['an unknown PEM label', HS, pem(new Uint8Array(8), 'DH PARAMETERS'), /not a public key/],
    ['a garbage SPKI', `${seg({ alg: 'RS256' })}.${seg({})}.AAAA`, pem(new Uint8Array(8), 'PUBLIC KEY'), /SubjectPublicKeyInfo/],
  ])('%s', async (_, tok, key, reason) => {
    expectStatus(await verifyJwt(tok, key), 'error', reason)
  })

  it('is invalid for an empty signature', async () => {
    expectStatus(await verifyJwt(`${seg({ alg: 'HS256' })}.${seg({})}.`, 'k'), 'invalid', /empty/)
  })

  it('never throws, whatever the key', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), fc.constantFrom('text', 'base64', 'base64url') , async (key, enc) => {
        const r = await verifyJwt(HS, key, { secretEncoding: enc })
        expect(['valid', 'invalid', 'error']).toContain(r.status)
        const j = await verifyJwt(HS, `{"keys":[${key}]}`)
        expect(['valid', 'invalid', 'error']).toContain(j.status)
      }),
      { numRuns: 200 },
    )
  })
})

describe('detectKeyFormat', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['my-secret', 'secret'],
    ['{"kty":"RSA"}', 'jwk'],
    ['{"kty":', 'jwk'],
    [' {"keys":[]} ', 'jwks'],
    ['-----BEGIN PUBLIC KEY-----\n…', 'pem'],
    ['-----BEGIN CERTIFICATE-----', 'pem'],
  ])('%j is %s', (input, format) => {
    expect(detectKeyFormat(input)).toBe(format)
  })
})

describe('der', () => {
  it('refuses lengths that overrun, and the indefinite form', () => {
    expect(readTlv(Uint8Array.of(0x30, 0x05, 0x00), 0)).toBeNull()
    expect(readTlv(Uint8Array.of(0x30, 0x80, 0x00, 0x00), 0)).toBeNull()
    expect(readTlv(Uint8Array.of(0x30, 0x84, 0xff, 0xff, 0xff, 0xff), 0)).toBeNull()
    expect(readTlv(Uint8Array.of(0x30), 0)).toBeNull()
    expect(readTlv(Uint8Array.of(0x04, 0x81, 0x01, 0xaa), 0)).toEqual({ tag: 4, start: 0, contentStart: 3, end: 4 })
  })

  it('names the curve of an EC SPKI', async () => {
    const { spki } = await publicForms((await pair(CASES[3].gen)).publicKey)
    expect(spkiAlgorithm(spki)).toEqual({ oid: '1.2.840.10045.2.1', param: '1.3.132.0.34' })
  })

  it('never throws on random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        certificateSpki(bytes)
        pkcs1ToSpki(bytes)
        spkiAlgorithm(bytes)
        isDerEcdsaSignature(bytes)
      }),
    )
  })
})
