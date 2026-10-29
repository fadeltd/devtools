import type { ByteFormat } from './format.ts'
import { findInvalidUtf8 } from './utf8.ts'

export type ParseErrorKind =
  /** Hex with an odd digit count: one nibble is left over. */
  | 'odd-hex'
  /** A binary group whose length is not a multiple of 8. */
  | 'binary-length'
  /** A decimal or octal value above 255. */
  | 'out-of-range'
  /** A character that is not a digit of the chosen base. */
  | 'invalid-digit'
  /** A `0x`, `\x`, `0b`, `0o` or `\` with no digits after it. */
  | 'dangling-prefix'

export interface ParseError {
  kind: ParseErrorKind
  /** The offending token, clipped to a readable length. */
  token: string
  /** 0-based character index of the token in the input. */
  index: number
  /** 1-based, for the message and for a person looking for it. */
  line: number
  column: number
  message: string
}

export type ParseResult = { ok: true; bytes: Uint8Array } | { ok: false; error: ParseError }

interface Spec {
  base: number
  /** Digits per byte when bytes are written back to back. */
  width: number
  name: string
}

const SPECS: Record<ByteFormat, Spec> = {
  binary: { base: 2, width: 8, name: 'binary' },
  octal: { base: 8, width: 3, name: 'octal' },
  decimal: { base: 10, width: 3, name: 'decimal' },
  hex: { base: 16, width: 2, name: 'hex' },
}

/**
 * Characters that only ever separate bytes. Beyond whitespace and commas this
 * takes the punctuation of a pasted array or string literal (`[72, 101]`,
 * `{0x48, 0x65}`, `"\x48\x65"`) and the colons of `de:ad:be:ef`. A minus sign
 * is deliberately absent: dropping it would silently read -5 as 5.
 */
function isSeparator(c: number): boolean {
  switch (c) {
    case 0x20: // space
    case 0x09: // tab
    case 0x0a: // \n
    case 0x0b: // \v
    case 0x0c: // \f
    case 0x0d: // \r
    case 0xa0: // nbsp, which copying out of a web page brings along
    case 0x2c: // ,
    case 0x3b: // ;
    case 0x3a: // :
    case 0x5b: // [
    case 0x5d: // ]
    case 0x7b: // {
    case 0x7d: // }
    case 0x28: // (
    case 0x29: // )
    case 0x22: // "
    case 0x27: // '
      return true
    default:
      return false
  }
}

function digitValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10
  return -1
}

/**
 * Length of the prefix at `p`, or 0. Recognised anywhere in a token, so
 * back-to-back literals (`\x48\x65`, `0x480x65`) split: the letter is never a
 * digit of its base, so `0x` cannot be the tail of a hex number.
 */
function prefixAt(s: string, p: number, end: number, format: ByteFormat): number {
  if (p + 1 >= end) return 0
  const a = s.charCodeAt(p)
  const b = s.charCodeAt(p + 1) | 0x20 // lowercase the letter
  if (a === 0x5c) {
    if (format === 'hex' && b === 0x78) return 2 // \x
    const d = digitValue(s.charCodeAt(p + 1))
    if (format === 'octal' && d >= 0 && d < 8) return 1 // \101
    return 0
  }
  if (a !== 0x30) return 0
  if (format === 'hex' && b === 0x78) return 2 // 0x
  if (format === 'binary' && b === 0x62) return 2 // 0b
  if (format === 'octal' && b === 0x6f) return 2 // 0o
  return 0
}

const CLIP = 32
function clip(s: string): string {
  return s.length > CLIP ? `${s.slice(0, CLIP)}…` : s
}

function makeError(input: string, kind: ParseErrorKind, index: number, rawToken: string, describe: (t: string) => string): ParseError {
  let line = 1
  let lineStart = 0
  for (let i = input.indexOf('\n'); i !== -1 && i < index; i = input.indexOf('\n', i + 1)) {
    line++
    lineStart = i + 1
  }
  const column = index - lineStart + 1
  const token = clip(rawToken)
  return {
    kind,
    token,
    index,
    line,
    column,
    message: `${describe(`“${token}”`)} (position ${index + 1}, line ${line}, column ${column}).`,
  }
}

/** Mutable output cursor, shared by the token walker so bytes land in one buffer. */
interface Sink {
  out: Uint8Array
  n: number
}

function emitPiece(
  input: string,
  pieceStart: number,
  ds: number,
  de: number,
  prefixed: boolean,
  format: ByteFormat,
  sink: Sink,
): ParseError | null {
  const spec = SPECS[format]
  const count = de - ds

  if (count === 0) {
    return makeError(input, 'dangling-prefix', pieceStart, input.slice(pieceStart, de), (t) => `${t} has no digits after it`)
  }

  const valueOf = (from: number, to: number) => {
    let v = 0
    // Capped, so a 10 MB run of digits cannot overflow into a false "valid".
    for (let k = from; k < to && v <= 255; k++) v = v * spec.base + digitValue(input.charCodeAt(k))
    return v
  }
  const push = (from: number, to: number): ParseError | null => {
    const v = valueOf(from, to)
    if (v > 255) {
      const max = format === 'octal' ? '377 (255)' : '255'
      return makeError(input, 'out-of-range', from, input.slice(from, to), (t) => `${t} is more than ${max}, the largest byte`)
    }
    sink.out[sink.n++] = v
    return null
  }
  const split = (width: number): ParseError | null => {
    for (let k = ds; k < de; k += width) {
      const err = push(k, k + width)
      if (err) return err
    }
    return null
  }

  // A prefix makes a short group an unambiguous number literal: \x9, 0b101.
  if (prefixed && count <= spec.width) return push(ds, de)

  switch (format) {
    case 'hex':
      if (count % 2 !== 0) {
        return makeError(input, 'odd-hex', ds, input.slice(ds, de), (t) => `Odd number of hex digits in ${t}: every byte needs two`)
      }
      return split(2)
    case 'binary':
      if (count % 8 !== 0) {
        return makeError(
          input,
          'binary-length',
          ds,
          input.slice(ds, de),
          (t) => `${t} is ${count} bits: binary bytes are groups of 8`,
        )
      }
      return split(8)
    case 'decimal':
    case 'octal':
      // Back-to-back digits only split cleanly when every byte was padded to 3.
      return count > 3 && count % 3 === 0 ? split(3) : push(ds, de)
  }
}

function parseToken(input: string, start: number, end: number, format: ByteFormat, sink: Sink): ParseError | null {
  const base = SPECS[format].base
  let p = start
  while (p < end) {
    const pieceStart = p
    const pl = prefixAt(input, p, end, format)
    p += pl
    const ds = p
    while (p < end) {
      const c = input.charCodeAt(p)
      if ((c === 0x5c || c === 0x30) && prefixAt(input, p, end, format) > 0) break
      const d = digitValue(c)
      if (d < 0 || d >= base) {
        const cp = input.codePointAt(p)!
        const ch = String.fromCodePoint(cp)
        return makeError(input, 'invalid-digit', p, ch, (t) => `${t} is not a ${SPECS[format].name} digit`)
      }
      p++
    }
    const err = emitPiece(input, pieceStart, ds, p, pl > 0, format, sink)
    if (err) return err
  }
  return null
}

/**
 * Parse bytes written in one format. Tolerant of layout (any mix of
 * whitespace, commas and literal punctuation, prefixes or none, separated or
 * back to back) and strict about content: a stray nibble or a 7-bit group is
 * an error with its position, never a guess.
 */
export function parseBytes(input: string, format: ByteFormat): ParseResult {
  // Every byte consumes at least one input character, so this never overflows.
  const sink: Sink = { out: new Uint8Array(input.length), n: 0 }
  const len = input.length
  let i = 0
  while (i < len) {
    while (i < len && isSeparator(input.charCodeAt(i))) i++
    if (i >= len) break
    const start = i
    while (i < len && !isSeparator(input.charCodeAt(i))) i++
    const err = parseToken(input, start, i, format, sink)
    if (err) return { ok: false, error: err }
  }
  return { ok: true, bytes: sink.out.slice(0, sink.n) }
}

export function hasContent(input: string): boolean {
  for (let i = 0; i < input.length; i++) if (!isSeparator(input.charCodeAt(i))) return true
  return false
}

/** Formats auto-detect chooses between, in tie-break order. Octal is never guessed: it is always valid decimal too. */
export const AUTO_ORDER = ['binary', 'hex', 'decimal'] as const satisfies readonly ByteFormat[]

export interface Detection {
  format: ByteFormat
  /**
   * - `prefix`: a `0x` or `\x` settles it.
   * - `only-valid`: just one format parses.
   * - `cleanest`: several parse; this one decodes to valid UTF-8 with the fewest control characters.
   * - `precedence`: several parse equally cleanly; the first in AUTO_ORDER wins.
   * - `none-valid`: nothing parses; this is the format that got furthest, whose error is reported.
   */
  reason: 'prefix' | 'only-valid' | 'cleanest' | 'precedence' | 'none-valid'
  /** The other formats the input is also valid in. Non-empty means the guess could be wrong. */
  alsoValid: ByteFormat[]
}

/** Lower is more text-like: [not valid UTF-8, control characters other than tab and newlines]. */
function score(bytes: Uint8Array): [number, number] {
  let controls = 0
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) controls++
  }
  return [findInvalidUtf8(bytes) === null ? 0 : 1, controls]
}

const cmp = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1]

/**
 * Guess the format, then parse with it.
 *
 * Many inputs are valid in more than one format: `10` is hex 0x10 and decimal
 * 10 (and only binary-ish, being 2 bits). The rule, in order:
 *  1. A `0x` or `\x` anywhere means hex. The `x` is never a digit, so this is certain.
 *  2. Parse as binary, hex and decimal. If exactly one succeeds, use it.
 *  3. If several succeed, prefer the one whose bytes look most like text: valid
 *     UTF-8 first, then fewest control characters. `10` becomes decimal (a newline)
 *     rather than hex (the DLE control code).
 *  4. A remaining tie goes to the first of binary, hex, decimal. Binary first
 *     because 8-digit runs of 0 and 1 are almost never meant as hex; hex before
 *     decimal because it is the more common way to write bytes.
 * The losers that also parse are reported, so the UI can say the guess is a guess.
 */
export function detectAndParse(input: string): { detection: Detection; result: ParseResult } {
  if (/[\\0][xX]/.test(input)) {
    return { detection: { format: 'hex', reason: 'prefix', alsoValid: [] }, result: parseBytes(input, 'hex') }
  }

  const attempts = AUTO_ORDER.map((format) => ({ format, result: parseBytes(input, format) }))
  const valid = attempts.flatMap((a) => (a.result.ok ? [{ format: a.format, bytes: a.result.bytes }] : []))

  if (valid.length === 0) {
    // Report the error of whichever format parsed furthest: for `48 65 6g`
    // that is hex, and "g is not a hex digit" is the useful message.
    let best = attempts[0]!
    for (const a of attempts) {
      if (!a.result.ok && !best.result.ok && a.result.error.index > best.result.error.index) best = a
    }
    return { detection: { format: best.format, reason: 'none-valid', alsoValid: [] }, result: best.result }
  }

  const scored = valid.map((v) => ({ ...v, score: score(v.bytes) }))
  // Stable sort: equal scores keep AUTO_ORDER, which is the tie-break.
  scored.sort((a, b) => cmp(a.score, b.score))
  const winner = scored[0]!
  const reason: Detection['reason'] =
    scored.length === 1 ? 'only-valid' : cmp(winner.score, scored[1]!.score) < 0 ? 'cleanest' : 'precedence'

  return {
    detection: {
      format: winner.format,
      reason,
      alsoValid: AUTO_ORDER.filter((f) => f !== winner.format && valid.some((v) => v.format === f)),
    },
    result: { ok: true, bytes: winner.bytes },
  }
}
