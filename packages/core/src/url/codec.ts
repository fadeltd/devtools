/**
 * Percent-encoding and decoding that reports bad input as data.
 *
 * The native functions throw a bare `URIError` with no position, both for a
 * lone surrogate on the way in and for a malformed escape on the way out. That
 * is useless on a pasted 4 KB redirect URL, so encoding pre-scans for lone
 * surrogates and decoding is a hand-written validator that knows exactly which
 * escape broke. Valid input produces byte-for-byte what the native functions
 * (and `URLSearchParams`, for form encoding) produce; the tests hold it to that.
 */

export type Variant = 'component' | 'uri' | 'form'

export interface Position {
  /** 0-based UTF-16 index into the input. */
  index: number
  /** 1-based. */
  line: number
  /** 1-based, in UTF-16 code units. */
  column: number
}

export function locate(s: string, index: number): Position {
  let line = 1
  let lineStart = 0
  for (let i = s.indexOf('\n'); i !== -1 && i < index; i = s.indexOf('\n', i + 1)) {
    line++
    lineStart = i + 1
  }
  return { index, line, column: index - lineStart + 1 }
}

function at(p: Position): string {
  return p.line > 1 ? `position ${p.index + 1} (line ${p.line}, column ${p.column})` : `position ${p.index + 1}`
}

function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0')
}

// --- Encoding --------------------------------------------------------------

export interface LoneSurrogate extends Position {
  /** The code unit, as `U+D83D`. */
  codeUnit: string
  /** How many lone surrogates the input holds in total. */
  count: number
  message: string
}

/** The first unpaired surrogate, or null when the string is well-formed UTF-16. */
export function findLoneSurrogate(s: string): LoneSurrogate | null {
  let first = -1
  let count = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0xd800 || c > 0xdfff) continue
    if (c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++
        continue
      }
    }
    if (first === -1) first = i
    count++
  }
  if (first === -1) return null
  const pos = locate(s, first)
  const codeUnit = `U+${s.charCodeAt(first).toString(16).toUpperCase()}`
  return {
    ...pos,
    codeUnit,
    count,
    message:
      `Lone surrogate ${codeUnit} at ${at(pos)}: half of an emoji or other astral character, ` +
      `with no valid UTF-8 form, so it cannot be percent-encoded` +
      (count > 1 ? ` (${count} in total).` : '.'),
  }
}

/** Lone surrogates become U+FFFD, which is what `URLSearchParams` does to them. */
export function toWellFormed(s: string): string {
  if (findLoneSurrogate(s) === null) return s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i]! + s[i + 1]!
        i++
        continue
      }
      out += '�'
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += '�'
    } else {
      out += s[i]!
    }
  }
  return out
}

// application/x-www-form-urlencoded escapes everything encodeURIComponent does,
// plus these five. Space is handled separately, as '+'.
const FORM_EXTRA = /[!'()~]/g

function encodeWellFormed(s: string, variant: Variant): string {
  switch (variant) {
    case 'component':
      return encodeURIComponent(s)
    case 'uri':
      return encodeURI(s)
    case 'form':
      return encodeURIComponent(s)
        .replace(FORM_EXTRA, (c) => `%${hex2(c.charCodeAt(0))}`)
        .replaceAll('%20', '+')
  }
}

export type EncodeResult =
  | { ok: true; output: string }
  | { ok: false; error: LoneSurrogate }

/**
 * - `component`: `encodeURIComponent`. Escapes everything but `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
 * - `uri`: `encodeURI`. Additionally keeps the URL syntax `; , / ? : @ & = + $ #`.
 * - `form`: exactly what `URLSearchParams` serialises a value as. Keeps only
 *   `A-Z a-z 0-9 * - . _`, and a space becomes `+`.
 */
export function encode(s: string, variant: Variant): EncodeResult {
  const lone = findLoneSurrogate(s)
  if (lone !== null) return { ok: false, error: lone }
  return { ok: true, output: encodeWellFormed(s, variant) }
}

// --- Decoding --------------------------------------------------------------

export type DecodeIssueKind = 'bad-escape' | 'invalid-utf8' | 'truncated-utf8'

export interface DecodeIssue extends Position {
  kind: DecodeIssueKind
  /** The offending text exactly as it appears in the input, e.g. `%E2%82`. */
  sequence: string
  message: string
}

export interface DecodeOptions {
  /** Treat `+` as a space, as form bodies and query strings do. */
  plusAsSpace: boolean
  /**
   * Keep escapes for `; / ? : @ & = + $ , #` as they are, the way `decodeURI`
   * does, so decoding a whole URL never changes its structure.
   */
  keepReserved: boolean
  /** Leave bad sequences in the output verbatim instead of failing. */
  lenient: boolean
}

export type DecodeResult =
  | {
      ok: true
      output: string
      /** Bad sequences left as-is. Always 0 unless `lenient`. */
      skipped: number
      /** The first of them, for the warning line. */
      firstSkipped: DecodeIssue | null
    }
  | { ok: false; error: DecodeIssue }

/** Modes per variant, so callers can decode with the same switch they encode with. */
export function decodeOptionsFor(variant: Variant, lenient: boolean): DecodeOptions {
  return { plusAsSpace: variant === 'form', keepReserved: variant === 'uri', lenient }
}

const RESERVED = new Set(';/?:@&=+$,#'.split('').map((c) => c.charCodeAt(0)))

function hexVal(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30
  if (c >= 0x41 && c <= 0x46) return c - 0x37
  if (c >= 0x61 && c <= 0x66) return c - 0x57
  return -1
}

function escapeAt(s: string, i: number): number {
  if (s.charCodeAt(i) !== 0x25) return -1
  const hi = hexVal(s.charCodeAt(i + 1))
  const lo = hexVal(s.charCodeAt(i + 2))
  return hi === -1 || lo === -1 ? -1 : hi * 16 + lo
}

/**
 * Length of the UTF-8 sequence a lead byte opens, and the allowed range of the
 * byte after it. The narrowed second-byte ranges are what reject overlongs
 * (E0, F0), UTF-16 surrogates (ED) and code points past U+10FFFF (F4).
 */
function leadInfo(b: number): [len: number, lo: number, hi: number] {
  if (b < 0x80) return [1, 0, 0]
  if (b >= 0xc2 && b <= 0xdf) return [2, 0x80, 0xbf]
  if (b === 0xe0) return [3, 0xa0, 0xbf]
  if (b === 0xed) return [3, 0x80, 0x9f]
  if (b >= 0xe1 && b <= 0xef) return [3, 0x80, 0xbf]
  if (b === 0xf0) return [4, 0x90, 0xbf]
  if (b >= 0xf1 && b <= 0xf3) return [4, 0x80, 0xbf]
  if (b === 0xf4) return [4, 0x80, 0x8f]
  return [0, 0, 0]
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

function issue(s: string, index: number, end: number, kind: DecodeIssueKind): DecodeIssue {
  const sequence = s.slice(index, end)
  const pos = locate(s, index)
  const what =
    kind === 'bad-escape'
      ? 'is not a valid escape: “%” must be followed by two hex digits'
      : kind === 'truncated-utf8'
        ? 'is an incomplete UTF-8 sequence'
        : 'is not valid UTF-8'
  return { ...pos, kind, sequence, message: `“${sequence}” at ${at(pos)} ${what}.` }
}

/**
 * The text a bad `%` is reported as: the `%` and up to two characters after
 * it, stopping early at the next `%` so `%4%41` reports `%4`, not `%4%`.
 */
function badEscapeEnd(s: string, i: number): number {
  let end = i + 1
  while (end < s.length && end < i + 3 && s[end] !== '%') end++
  return end
}

export function decode(s: string, o: DecodeOptions): DecodeResult {
  const parts: string[] = []
  let skipped = 0
  let firstSkipped: DecodeIssue | null = null

  const literal = (from: number, to: number) => {
    if (from >= to) return
    const text = s.slice(from, to)
    parts.push(o.plusAsSpace ? text.replaceAll('+', ' ') : text)
  }

  /**
   * Records a bad sequence and returns the issue when it ends the decode.
   * Only the first one is located: locating is linear, and a lenient pass
   * over a large paste may skip thousands.
   */
  const bad = (from: number, to: number, kind: DecodeIssueKind, keep: string): DecodeIssue | null => {
    if (!o.lenient) return issue(s, from, to, kind)
    skipped++
    firstSkipped ??= issue(s, from, to, kind)
    parts.push(keep)
    return null
  }

  let i = 0
  let literalStart = 0
  while (true) {
    const pct = s.indexOf('%', i)
    if (pct === -1) break
    literal(literalStart, pct)

    // Measure the run of well-formed escapes starting here.
    let end = pct
    while (escapeAt(s, end) !== -1) end += 3
    const n = (end - pct) / 3

    if (n === 0) {
      // Only the `%` is kept here. What follows it is ordinary text that the
      // scan must still see: a `+` in it is a space, and `%%41` is `%A`.
      const error = bad(pct, badEscapeEnd(s, pct), 'bad-escape', '%')
      if (error !== null) return { ok: false, error }
      i = literalStart = pct + 1
      continue
    }

    const bytes = new Uint8Array(n)
    for (let k = 0; k < n; k++) bytes[k] = escapeAt(s, pct + k * 3)

    // Walk the bytes code point by code point, flushing each valid stretch
    // through TextDecoder and handling reserved and bad bytes in between.
    let validFrom = 0
    const flush = (to: number) => {
      if (to > validFrom) parts.push(utf8.decode(bytes.subarray(validFrom, to)))
    }
    let k = 0
    while (k < n) {
      const b = bytes[k]!
      const [len, lo, hi] = leadInfo(b)
      if (len === 1) {
        if (o.keepReserved && RESERVED.has(b)) {
          flush(k)
          parts.push(s.slice(pct + k * 3, pct + k * 3 + 3))
          validFrom = k + 1
        }
        k++
        continue
      }

      // Count how many continuation bytes are actually there and valid.
      let got = 1
      let kind: DecodeIssueKind | null = len === 0 ? 'invalid-utf8' : null
      while (kind === null && got < len) {
        if (k + got >= n) {
          kind = 'truncated-utf8'
          break
        }
        const c = bytes[k + got]!
        const [min, max] = got === 1 ? [lo, hi] : [0x80, 0xbf]
        if (c < min || c > max) {
          kind = 'invalid-utf8'
          break
        }
        got++
      }
      if (kind === null) {
        k += len
        continue
      }

      // The bad unit is the lead byte plus the continuations that matched:
      // the "maximal subpart", so one broken emoji is one issue, not four.
      flush(k)
      const from = pct + k * 3
      const to = pct + (k + got) * 3
      const error = bad(from, to, kind, s.slice(from, to))
      if (error !== null) return { ok: false, error }
      k += got
      validFrom = k
    }
    flush(n)
    i = literalStart = end
  }
  literal(literalStart, s.length)

  return { ok: true, output: parts.join(''), skipped, firstSkipped }
}

// --- Double encoding ------------------------------------------------------

const ESCAPE = /%[0-9A-Fa-f]{2}/g
const DOUBLE = /%25[0-9A-Fa-f]{2}/g

/** How many well-formed `%XX` escapes the string holds. */
export function countEscapes(s: string): number {
  return s.match(ESCAPE)?.length ?? 0
}

export interface DoubleEncoding extends Position {
  /** The first `%25XX`, e.g. `%2520`. */
  sample: string
  /** What one decode turns it into, e.g. `%20`. */
  decodesTo: string
  count: number
}

/**
 * `%2520` is what `%20` becomes after a second encode. It is a near-certain
 * sign of double encoding: a literal `%` followed by two hex digits is rare in
 * real data, and that is the only other way to get it.
 */
export function detectDoubleEncoding(s: string): DoubleEncoding | null {
  DOUBLE.lastIndex = 0
  const first = DOUBLE.exec(s)
  if (first === null) return null
  const count = s.match(DOUBLE)?.length ?? 0
  return {
    ...locate(s, first.index),
    sample: first[0],
    decodesTo: `%${first[0].slice(3)}`,
    count,
  }
}
