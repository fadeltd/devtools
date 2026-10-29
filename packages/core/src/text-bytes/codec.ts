import { renderBytes, type ByteFormat, type FormatOptions } from './format.ts'
import { detectAndParse, hasContent, parseBytes, type Detection, type ParseError, type ParseResult } from './parse.ts'
import { findInvalidUtf8, latin1, scanText, type Utf8Error } from './utf8.ts'

export type InputFormat = ByteFormat | 'auto'

export interface EncodeResult {
  output: string
  byteCount: number
  charCount: number
  /** Unpaired surrogates that went out as EF BF BD (U+FFFD). Worth saying: the bytes are not the text. */
  loneSurrogates: number
}

const encoder = new TextEncoder()

/** Text to its UTF-8 bytes, formatted. Always UTF-8: there is no "ASCII mode" to get wrong. */
export function encodeText(text: string, o: FormatOptions): EncodeResult {
  const bytes = encoder.encode(text)
  const scan = scanText(text)
  return {
    output: renderBytes(bytes, o),
    byteCount: bytes.length,
    charCount: scan.codePoints,
    loneSurrogates: scan.loneSurrogates,
  }
}

interface Common {
  /** The format actually used: the chosen one, or the detected one. Null for empty auto input. */
  format: ByteFormat | null
  /** Present only when the input format was 'auto' and there was something to detect. */
  detection: Detection | null
}

export type DecodeResult =
  | (Common & {
      ok: true
      text: string
      bytes: Uint8Array
      charCount: number
      /** The text starts with U+FEFF. It is kept, not stripped, so text → bytes → text is lossless. */
      bom: boolean
    })
  | (Common & { ok: false; reason: 'syntax'; error: ParseError })
  | (Common & {
      ok: false
      reason: 'not-utf8'
      bytes: Uint8Array
      invalid: Utf8Error
      /** Each invalid sequence as U+FFFD: shows where the damage is. Not the real text. */
      replacement: string
      /** Each byte as U+0000–U+00FF: shows every byte. Not the real text either. */
      latin1: string
    })

/** Bytes, written in some format, back to text. Bad input is reported as data, never thrown. */
export function decodeText(input: string, format: InputFormat): DecodeResult {
  let used: ByteFormat | null
  let detection: Detection | null = null
  let parsed: ParseResult

  if (format === 'auto') {
    if (!hasContent(input)) {
      parsed = { ok: true, bytes: new Uint8Array(0) }
      used = null
    } else {
      const d = detectAndParse(input)
      detection = d.detection
      parsed = d.result
      used = d.detection.format
    }
  } else {
    parsed = parseBytes(input, format)
    used = format
  }

  if (!parsed.ok) return { ok: false, reason: 'syntax', error: parsed.error, format: used, detection }
  const bytes = parsed.bytes

  const invalid = findInvalidUtf8(bytes)
  if (invalid !== null) {
    return {
      ok: false,
      reason: 'not-utf8',
      bytes,
      invalid,
      replacement: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes),
      latin1: latin1(bytes),
      format: used,
      detection,
    }
  }

  // ignoreBOM keeps a leading EF BB BF as U+FEFF. The default strips it, which
  // makes "\uFEFFhi" → bytes → text come back as "hi".
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  return {
    ok: true,
    text,
    bytes,
    charCount: scanText(text).codePoints,
    bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    format: used,
    detection,
  }
}
