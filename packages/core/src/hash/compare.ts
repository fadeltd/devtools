import { parseBase64, parseHex, type ParseBytesResult } from './bytes.ts'
import { ALGORITHMS, DIGEST_LENGTH, type Algorithm } from './digest.ts'

/**
 * Constant time in the CONTENT of the inputs: every byte is visited whatever
 * the first mismatch, so a remote caller cannot recover a signature one byte
 * at a time from response timing. Length is not secret (it is fixed by the
 * algorithm), so a length mismatch returns early.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

/**
 * Labels that wrap a digest in the wild: `sha256=` (GitHub), `v0=` / `v1=`
 * (Slack, Stripe), `sha256:` (Docker, OCI) and `sha384-` (Subresource
 * Integrity). Hex never contains `s` or `v`, so stripping these cannot eat
 * digest characters.
 */
const LABEL = /^(?:sha-?(?:1|256|384|512)|v\d)[=:-]/i

const HEX_LENGTHS = new Set(ALGORITHMS.map((a) => DIGEST_LENGTH[a] * 2))

/**
 * Turn a pasted digest or signature into bytes, so comparison is immune to
 * hex case, spacing and labels. Even-length text of only hex digits is hex;
 * anything else is tried as base64 (either alphabet). A real base64 digest
 * that happens to be all hex digits has odds around (22/64)^43 -- not a case.
 *
 * `sha256sum` output (`<hex>  filename`) is accepted by taking the first
 * token when it alone is a well-formed hex digest.
 */
export function parseDigestString(input: string): ParseBytesResult {
  let s = input.trim()
  const firstToken = s.split(/\s+/, 1)[0] ?? ''
  if (firstToken !== s && isHexDigest(firstToken.replace(LABEL, ''))) s = firstToken
  s = s.replace(LABEL, '').replace(/\s+/g, '')

  if (s === '') return { ok: false, message: 'Empty.' }
  if (s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s)) return parseHex(s)
  return parseBase64(s)
}

function isHexDigest(s: string): boolean {
  return HEX_LENGTHS.has(s.length) && /^[0-9a-f]+$/i.test(s)
}

export type DigestMatch =
  | { status: 'match'; algorithm: Algorithm }
  | { status: 'none' }
  | { status: 'invalid'; message: string }

/** Which of the computed digests, if any, the pasted one is. */
export function matchDigest(
  candidate: string,
  digests: Partial<Record<Algorithm, Uint8Array>>,
): DigestMatch {
  const parsed = parseDigestString(candidate)
  if (!parsed.ok) return { status: 'invalid', message: parsed.message }
  for (const algorithm of ALGORITHMS) {
    const d = digests[algorithm]
    if (d !== undefined && timingSafeEqual(parsed.bytes, d)) return { status: 'match', algorithm }
  }
  return { status: 'none' }
}
