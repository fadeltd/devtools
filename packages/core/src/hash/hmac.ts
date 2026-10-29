import { parseBase64, parseHex, type ParseBytesResult } from './bytes.ts'
import { toBytes, type Algorithm } from './digest.ts'

export type KeyEncoding = 'text' | 'hex' | 'base64'

const encoder = new TextEncoder()

/**
 * Most webhook secrets (Stripe's `whsec_…`, GitHub's, Slack's) are used as the
 * literal UTF-8 text of the secret, prefix included -- not decoded first.
 */
export function decodeKey(key: string, encoding: KeyEncoding): ParseBytesResult {
  switch (encoding) {
    case 'text':
      return { ok: true, bytes: encoder.encode(key) }
    case 'hex':
      return parseHex(key)
    case 'base64':
      return parseBase64(key)
  }
}

export type HmacResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; message: string; position?: number }

/** HMAC's key schedule zero-pads the key to the block size (RFC 2104 §2). */
const ZERO_KEY = new Uint8Array([0])

/**
 * The key is UTF-8 text by default, or hex / base64 via `encoding`, or raw
 * bytes. A malformed key comes back as `ok: false` with a message rather than
 * a throw, so a half-typed hex key is a status line, not a crash.
 */
export async function hmac(
  algorithm: Algorithm,
  key: string | Uint8Array,
  message: string | Uint8Array,
  encoding: KeyEncoding = 'text',
): Promise<HmacResult> {
  let keyBytes: Uint8Array
  if (typeof key === 'string') {
    const decoded = decodeKey(key, encoding)
    if (!decoded.ok) return decoded
    keyBytes = decoded.bytes
  } else {
    keyBytes = key
  }

  // WebCrypto refuses a zero-length HMAC key (DataError), but HMAC itself is
  // defined for one. Zero-padding makes the empty key and a single 0x00 byte
  // the same key, so the substitution is exact, not an approximation.
  if (keyBytes.length === 0) keyBytes = ZERO_KEY

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes as Uint8Array<ArrayBuffer>,
      { name: 'HMAC', hash: algorithm },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, toBytes(message) as Uint8Array<ArrayBuffer>)
    return { ok: true, bytes: new Uint8Array(sig) }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
