import { base64ToBytes } from '../base64/codec.ts'

export type ParseBytesResult =
  | { ok: true; bytes: Uint8Array }
  /** `position` is a UTF-16 index into the ORIGINAL input, for a caret. */
  | { ok: false; message: string; position?: number }

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10
  return -1
}

/**
 * Hex as people actually paste it: either case, an optional `0x`, and
 * whitespace between groups (`xxd` and RFC test vectors both wrap).
 */
export function parseHex(input: string): ParseBytesResult {
  let start = 0
  while (start < input.length && isSpace(input[start]!)) start++
  if (input.startsWith('0x', start) || input.startsWith('0X', start)) start += 2

  const nibbles: number[] = []
  for (let i = start; i < input.length; i++) {
    const c = input[i]!
    if (isSpace(c)) continue
    const v = hexValue(input.charCodeAt(i))
    if (v < 0) {
      return { ok: false, message: `“${c}” is not a hex digit (position ${i + 1}).`, position: i }
    }
    nibbles.push(v)
  }

  if (nibbles.length % 2 !== 0) {
    return {
      ok: false,
      message: `Odd number of hex digits (${nibbles.length}): every byte needs two.`,
    }
  }
  const bytes = new Uint8Array(nibbles.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (nibbles[2 * i]! << 4) | nibbles[2 * i + 1]!
  return { ok: true, bytes }
}

const BASE64_CHAR = /[A-Za-z0-9+/\-_]/

/**
 * Standard or URL alphabet, padded or not, with whitespace ignored. Bad
 * characters are located here rather than left to `atob`, whose error names
 * no position.
 */
export function parseBase64(input: string): ParseBytesResult {
  let clean = ''
  let padStart = -1
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (isSpace(c)) continue
    if (c === '=') {
      if (padStart < 0) padStart = i
      clean += c
      continue
    }
    if (padStart >= 0) {
      return {
        ok: false,
        message: `“=” is padding and may only appear at the end (position ${padStart + 1}).`,
        position: padStart,
      }
    }
    if (!BASE64_CHAR.test(c)) {
      return { ok: false, message: `“${c}” is not a base64 character (position ${i + 1}).`, position: i }
    }
    clean += c
  }

  try {
    return { ok: true, bytes: base64ToBytes(clean, { alphabet: 'auto', lenient: true }) }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
