/**
 * Bad input is data, not an exception: every parser in this module returns
 * one of these instead of throwing, so the UI can render it inline.
 *
 * `index` is a UTF-16 offset into the string the caller passed in, before any
 * trimming, so a caret drawn under the original input lands on the culprit.
 */
export interface InputError {
  code: string
  message: string
  index?: number
  char?: string
}

export type Parsed<T> = ({ ok: true } & T) | { ok: false; error: InputError }

export function fail(code: string, message: string, index?: number, char?: string): { ok: false; error: InputError } {
  const error: InputError = { code, message }
  if (index !== undefined) error.index = index
  if (char !== undefined) error.char = char
  return { ok: false, error }
}

/** Show a character in a message so whitespace and control chars are visible. */
export function quoteChar(ch: string): string {
  if (ch === ' ') return 'a space'
  const cp = ch.codePointAt(0) ?? 0
  if (cp < 0x20 || cp === 0x7f) return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
  return `“${ch}”`
}

/** Offsets of the first and one-past-last non-whitespace characters. */
export function trimBounds(input: string): [number, number] {
  let start = 0
  let end = input.length
  while (start < end && /\s/.test(input[start] ?? '')) start++
  while (end > start && /\s/.test(input[end - 1] ?? '')) end--
  return [start, end]
}
