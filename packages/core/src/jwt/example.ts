import { bytesToBase64 } from '../base64/codec.ts'

const encoder = new TextEncoder()

/** base64url(JSON) with no padding: one compact-JWS segment. */
export function encodeJsonSegment(value: unknown): string {
  return bytesToBase64(encoder.encode(JSON.stringify(value)), { alphabet: 'base64url', padding: false })
}

/**
 * A demonstration token, valid for an hour from `now` (ms). The signature is
 * the bytes 0..31, not an HMAC of anything: it only has the right length for
 * HS256, which is all a decoder that never verifies can show.
 */
export function exampleToken(now: number): string {
  const iat = Math.floor(now / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: 'https://auth.example.com',
    sub: 'user_1234',
    aud: 'devtools-example',
    iat,
    nbf: iat,
    exp: iat + 3600,
    jti: 'example-0001',
    name: 'Ada Lovelace',
    roles: ['reader'],
  }
  const signature = bytesToBase64(Uint8Array.from({ length: 32 }, (_, i) => i), {
    alphabet: 'base64url',
    padding: false,
  })
  return `${encodeJsonSegment(header)}.${encodeJsonSegment(payload)}.${signature}`
}
