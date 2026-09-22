export type Alphabet = 'base64' | 'base64url'

export interface EncodeOptions {
  alphabet: Alphabet
  padding: boolean
  /** Insert a line break every N characters (PEM uses 64, MIME 76). */
  wrapAt?: number
}

export interface DecodeOptions {
  /** 'auto' detects base64url from the presence of - or _. */
  alphabet: Alphabet | 'auto'
  /** Accept a final partial chunk and stray padding instead of erroring. */
  lenient: boolean
}

/**
 * The native API (Baseline *newly* available, Sept 2025) is used when present.
 * It is not Baseline widely available until ~2028 and is absent from current
 * Node, so the fallback below is load-bearing, not decorative.
 */
export const HAS_NATIVE_BASE64 =
  typeof (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 === 'function' &&
  typeof (Uint8Array.prototype as unknown as { toBase64?: unknown }).toBase64 === 'function'

interface NativeU8 {
  toBase64: (o?: { alphabet?: string; omitPadding?: boolean }) => string
}
interface NativeU8Ctor {
  fromBase64: (s: string, o?: { alphabet?: string; lastChunkHandling?: string }) => Uint8Array
}

/** 0x8000 at a time: String.fromCharCode(...bigArray) blows the argument limit. */
const CHARCODE_CHUNK = 0x8000

/** @internal exported so the fallback is tested even where native exists. */
export function bytesToBase64Fallback(bytes: Uint8Array, o: EncodeOptions): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHARCODE_CHUNK) {
    binary += String.fromCharCode(
      ...(bytes.subarray(i, i + CHARCODE_CHUNK) as unknown as number[]),
    )
  }
  let out = btoa(binary)
  if (o.alphabet === 'base64url') out = out.replaceAll('+', '-').replaceAll('/', '_')
  if (!o.padding) out = out.replace(/=+$/, '')
  return out
}

/** @internal exported so the fallback is tested even where native exists. */
export function base64ToBytesFallback(input: string, o: DecodeOptions): Uint8Array {
  const std = toStandardAlphabet(input, o.alphabet)
  const padded = repad(std, o.lenient)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function toStandardAlphabet(s: string, alphabet: Alphabet | 'auto'): string {
  const isUrl = alphabet === 'base64url' || (alphabet === 'auto' && /[-_]/.test(s))
  return isUrl ? s.replaceAll('-', '+').replaceAll('_', '/') : s
}

function repad(s: string, lenient: boolean): string {
  const stripped = s.replace(/=+$/, '')
  const remainder = stripped.length % 4

  if (remainder === 1) {
    // 1 leftover character can never encode a byte, in any mode.
    throw new SyntaxError('Truncated base64: a final chunk of 1 character is impossible')
  }
  if (remainder === 0) return stripped

  // remainder is 2 or 3, so the input was written without padding. Strict mode
  // judges the ORIGINAL length: correctly padded input is fine, and only a
  // genuinely unpadded payload is rejected. (Checking the stripped length here
  // would reject every properly padded string, which is the subtle bug.)
  if (!lenient && s.length % 4 !== 0) {
    throw new SyntaxError(
      `Base64 length is not a multiple of 4 (${s.length} characters). ` +
        'Enable lenient mode to decode unpadded input.',
    )
  }
  return stripped + '='.repeat(4 - remainder)
}

export function bytesToBase64(bytes: Uint8Array, o: EncodeOptions): string {
  let out: string
  if (HAS_NATIVE_BASE64) {
    out = (bytes as unknown as NativeU8).toBase64({
      alphabet: o.alphabet,
      omitPadding: !o.padding,
    })
  } else {
    out = bytesToBase64Fallback(bytes, o)
  }
  return o.wrapAt !== undefined && o.wrapAt > 0 ? wrap(out, o.wrapAt) : out
}

export function base64ToBytes(input: string, o: DecodeOptions): Uint8Array {
  if (!HAS_NATIVE_BASE64) return base64ToBytesFallback(input, o)
  const std = toStandardAlphabet(input, o.alphabet)
  const padded = repad(std, o.lenient)
  return (Uint8Array as unknown as NativeU8Ctor).fromBase64(padded, {
    alphabet: 'base64',
    lastChunkHandling: o.lenient ? 'loose' : 'strict',
  })
}

export function wrap(s: string, width: number): string {
  if (width <= 0 || s.length <= width) return s
  const lines: string[] = []
  for (let i = 0; i < s.length; i += width) lines.push(s.slice(i, i + width))
  return lines.join('\n')
}

const encoder = new TextEncoder()

export function encodeText(text: string, o: EncodeOptions): string {
  // Via TextEncoder, never btoa(text): btoa throws on any code point > 255,
  // which is every non-ASCII character.
  return bytesToBase64(encoder.encode(text), o)
}

export type DecodeTextResult =
  | { ok: true; text: string; bytes: Uint8Array }
  | { ok: false; reason: 'not-utf8'; bytes: Uint8Array }
  | { ok: false; reason: 'invalid-base64'; message: string }

export function decodeText(input: string, o: DecodeOptions): DecodeTextResult {
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(input, o)
  } catch (e) {
    return {
      ok: false,
      reason: 'invalid-base64',
      message: e instanceof Error ? e.message : String(e),
    }
  }

  try {
    // fatal: true so invalid UTF-8 throws instead of yielding U+FFFD soup that
    // silently looks like a successful decode.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { ok: true, text, bytes }
  } catch {
    return { ok: false, reason: 'not-utf8', bytes }
  }
}

/** Decode with an explicit legacy encoding, for the "not UTF-8" escape hatch. */
export function decodeBytesAs(bytes: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding, { fatal: false }).decode(bytes)
}

/** Exact encoded length: 4*ceil(n/3) padded, ceil(4n/3) unpadded. */
export function base64Length(byteLength: number, padding: boolean): number {
  return padding
    ? 4 * Math.ceil(byteLength / 3)
    : Math.ceil((byteLength * 4) / 3)
}
