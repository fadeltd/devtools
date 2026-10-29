export type Utf8Problem =
  /** 0x80–0xBF where a sequence should start. */
  | 'unexpected-continuation'
  /** 0xC0, 0xC1 or 0xF5–0xFF: bytes that never appear in UTF-8. */
  | 'invalid-lead'
  /** A lead byte whose next byte does not continue it (this also catches overlongs and surrogates). */
  | 'bad-continuation'
  /** The input ends part-way through a sequence. */
  | 'truncated'

export interface Utf8Error {
  /** Byte offset of the first invalid sequence. */
  offset: number
  /** Bytes in that sequence, i.e. what one U+FFFD replaces. */
  length: number
  problem: Utf8Problem
  /** Every invalid sequence in the input, so "1 bad byte" and "half the input" read differently. */
  count: number
  message: string
}

const hex2 = (b: number) => `0x${b.toString(16).padStart(2, '0')}`

/**
 * The first invalid UTF-8 sequence, or null when the bytes are valid.
 *
 * TextDecoder's fatal mode only says *that* decoding failed, not where, so this
 * walks the bytes itself. Sequence boundaries follow the WHATWG "maximal
 * subpart" rule, which is exactly where a non-fatal decoder puts each U+FFFD.
 */
export function findInvalidUtf8(bytes: Uint8Array): Utf8Error | null {
  let first: Omit<Utf8Error, 'count' | 'message'> | null = null
  let count = 0
  const n = bytes.length
  let i = 0

  while (i < n) {
    const b = bytes[i]!
    if (b < 0x80) {
      i++
      continue
    }

    let need: number
    // The first continuation byte has a narrower range for some leads: that is
    // what rules out overlongs (E0, F0), surrogates (ED) and > U+10FFFF (F4).
    let lo = 0x80
    let hi = 0xbf
    if (b >= 0xc2 && b <= 0xdf) need = 1
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2
      if (b === 0xe0) lo = 0xa0
      if (b === 0xed) hi = 0x9f
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3
      if (b === 0xf0) lo = 0x90
      if (b === 0xf4) hi = 0x8f
    } else {
      count++
      first ??= { offset: i, length: 1, problem: b <= 0xbf ? 'unexpected-continuation' : 'invalid-lead' }
      i++
      continue
    }

    let j = i + 1
    let problem: Utf8Problem | null = null
    for (let k = 0; k < need; k++, j++) {
      if (j >= n) {
        problem = 'truncated'
        break
      }
      const c = bytes[j]!
      if (c < lo || c > hi) {
        problem = 'bad-continuation'
        break
      }
      lo = 0x80
      hi = 0xbf
    }

    if (problem !== null) {
      count++
      first ??= { offset: i, length: j - i, problem }
    }
    // On failure j is the byte that broke the sequence, and decoding resumes
    // there: it may itself start a valid character.
    i = j
  }

  if (first === null) return null
  return { ...first, count, message: describe(bytes, first, count) }
}

function describe(bytes: Uint8Array, e: Omit<Utf8Error, 'count' | 'message'>, count: number): string {
  const lead = hex2(bytes[e.offset]!)
  let what: string
  switch (e.problem) {
    case 'unexpected-continuation':
      what = `byte ${lead} at offset ${e.offset} is a continuation byte with nothing to continue`
      break
    case 'invalid-lead':
      what = `byte ${lead} at offset ${e.offset} never appears in UTF-8`
      break
    case 'bad-continuation':
      what = `${lead} at offset ${e.offset} starts a multi-byte character, but ${hex2(bytes[e.offset + e.length]!)} does not continue it`
      break
    case 'truncated':
      what = `the bytes end part-way through the character that starts with ${lead} at offset ${e.offset}`
      break
  }
  const more = count > 1 ? ` (${count} invalid sequences in total)` : ''
  return `Not valid UTF-8: ${what}${more}.`
}

/** 0x8000 at a time: String.fromCharCode(...bigArray) blows the argument limit. */
const CHARCODE_CHUNK = 0x8000

/**
 * True ISO-8859-1: byte n is U+00nn. Not `new TextDecoder('latin1')`, which the
 * Encoding Standard maps to windows-1252 and so renders 0x80–0x9F as €‚ƒ….
 */
export function latin1(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHARCODE_CHUNK) {
    parts.push(String.fromCharCode(...(bytes.subarray(i, i + CHARCODE_CHUNK) as unknown as number[])))
  }
  return parts.join('')
}

export interface TextScan {
  /** Characters as a person counts them: code points, so 🎉 is 1, not 2. */
  codePoints: number
  /** Unpaired surrogates, which TextEncoder silently turns into U+FFFD. */
  loneSurrogates: number
}

export function scanText(text: string): TextScan {
  let codePoints = 0
  let loneSurrogates = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    codePoints++
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i++
      else loneSurrogates++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      loneSurrogates++
    }
  }
  return { codePoints, loneSurrogates }
}
