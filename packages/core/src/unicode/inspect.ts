import { countGraphemes } from '../text/counts.ts'
import { buildLineIndex, offsetToLineCol, type LineIndex } from '../text/offsets.ts'
import {
  abbreviationOf,
  baseMask,
  FLAG_BIT,
  flagsOf,
  GENERAL_CATEGORIES,
  generalCategory,
  nameOf,
  UNICODE_FLAGS,
  type GeneralCategory,
  type UnicodeFlag,
} from './tables.ts'

/**
 * One linear pass over the text, so that a virtualised table can ask for any
 * row in O(log n) without materialising millions of row objects.
 */
export interface UnicodeIndex {
  text: string
  codePoints: number
  /** UTF-16 offset of each code point, plus a trailing sentinel at text.length. */
  offsets: Uint32Array
  lines: LineIndex
  /** Code-point indices of flagged rows, ascending. */
  flagged: Uint32Array
  /** Flag bitmask for each entry of `flagged` (see FLAG_BIT). */
  masks: Uint16Array
  /** What TextEncoder would write. A lone surrogate becomes U+FFFD: 3 bytes. */
  utf8Bytes: number
}

export interface CodePointRow {
  /** Code-point index: the row number. */
  index: number
  /** UTF-16 offset, which is what String.prototype.slice and editors count. */
  offset: number
  /** UTF-16 units this code point occupies: 2 for anything above U+FFFF. */
  length: number
  /** 1-based. The column counts UTF-16 units, as JavaScript and most editors do. */
  line: number
  column: number
  char: string
  codePoint: number
  /** `U+200B` */
  hex: string
  /** `E2 80 8B`. Null for a lone surrogate, which has no UTF-8 encoding. */
  utf8: string | null
  /** `D83D DE00` */
  utf16: string
  category: GeneralCategory
  categoryName: string
  flags: UnicodeFlag[]
  name: string | null
  /**
   * What to draw in the character cell. When `placeholder` is true it is a
   * short label to box, never the raw glyph: an invisible character drawn as
   * itself is exactly the bug this tool exists to expose.
   */
  display: string
  placeholder: boolean
}

const ZWJ = 0x200d
const WAVING_BLACK_FLAG = 0x1f3f4
const CANCEL_TAG = 0xe007f
const RE_PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u

function isHigh(u: number): boolean {
  return u >= 0xd800 && u <= 0xdbff
}

function isLow(u: number): boolean {
  return u >= 0xdc00 && u <= 0xdfff
}

/** Code point starting at `offset`, or -1 at the end. Lone surrogates come back as themselves. */
function codePointAt(text: string, offset: number): number {
  return offset < text.length ? text.codePointAt(offset)! : -1
}

/** Start offset of the code point that ends just before `offset`. */
function previousStart(text: string, offset: number): number {
  if (offset >= 2 && isLow(text.charCodeAt(offset - 1)) && isHigh(text.charCodeAt(offset - 2))) {
    return offset - 2
  }
  return offset - 1
}

function isPictographic(cp: number): boolean {
  return cp >= 0 && RE_PICTOGRAPHIC.test(String.fromCodePoint(cp))
}

/**
 * A ZWJ between two emoji is doing its job (👨‍👩‍👧, 🏳️‍🌈) and is not what
 * anyone is hunting for. Flagging it would put a warning on every family emoji
 * and make clean() split them apart.
 */
function joinsEmoji(text: string, offset: number): boolean {
  let before = previousStart(text, offset)
  while (before >= 0) {
    const cp = text.codePointAt(before)!
    // Presentation selectors and skin tones sit between the emoji and the ZWJ.
    if (cp === 0xfe0e || cp === 0xfe0f || (cp >= 0x1f3fb && cp <= 0x1f3ff)) {
      before = previousStart(text, before)
      continue
    }
    if (!isPictographic(cp)) return false
    break
  }
  return before >= 0 && isPictographic(codePointAt(text, offset + 1))
}

/**
 * Subdivision flags (🏴󠁧󠁢󠁳󠁣󠁴󠁿) are U+1F3F4, tag characters, then CANCEL TAG. Returns the
 * offset just past a well-formed sequence starting at `offset`, or -1. Tags
 * anywhere else are hidden text -- the "ASCII smuggling" trick.
 */
function tagSequenceEnd(text: string, offset: number): number {
  let i = offset
  let tags = 0
  for (;;) {
    const cp = codePointAt(text, i)
    if (cp >= 0xe0020 && cp <= 0xe007e) {
      tags++
      i += 2
    } else if (cp === CANCEL_TAG && tags > 0) {
      return i + 2
    } else {
      return -1
    }
  }
}

export function buildIndex(text: string): UnicodeIndex {
  const n = text.length
  // Upper bound: one code point per unit. A subarray keeps it to one allocation.
  const offsets = new Uint32Array(n + 1)
  const flagged: number[] = []
  const masks: number[] = []
  let count = 0
  let utf8Bytes = 0
  let tagSeqEnd = -1

  for (let i = 0; i < n; ) {
    const u = text.charCodeAt(i)
    offsets[count] = i
    let cp = u
    let len = 1
    if (isHigh(u) && i + 1 < n) {
      const v = text.charCodeAt(i + 1)
      if (isLow(v)) {
        cp = ((u - 0xd800) << 10) + (v - 0xdc00) + 0x10000
        len = 2
      }
    }

    utf8Bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4

    // Printable ASCII is the overwhelming majority of real input and never flags.
    if (cp < 0x20 || cp >= 0x7f) {
      let mask = baseMask(cp)
      if (mask === FLAG_BIT.invisible && cp === ZWJ && joinsEmoji(text, i)) mask = 0
      else if (mask === FLAG_BIT.tag && i < tagSeqEnd) mask = 0
      if (cp === WAVING_BLACK_FLAG) tagSeqEnd = tagSequenceEnd(text, i + len)
      if (mask !== 0) {
        flagged.push(count)
        masks.push(mask)
      }
    }

    count++
    i += len
  }
  offsets[count] = n

  return {
    text,
    codePoints: count,
    offsets: offsets.subarray(0, count + 1),
    lines: buildLineIndex(text),
    flagged: Uint32Array.from(flagged),
    masks: Uint16Array.from(masks),
    utf8Bytes,
  }
}

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, '0')
}

function utf8Hex(cp: number): string | null {
  if (cp >= 0xd800 && cp <= 0xdfff) return null
  let bytes: number[]
  if (cp < 0x80) bytes = [cp]
  else if (cp < 0x800) bytes = [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
  else if (cp < 0x10000) bytes = [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
  else {
    bytes = [
      0xf0 | (cp >> 18),
      0x80 | ((cp >> 12) & 0x3f),
      0x80 | ((cp >> 6) & 0x3f),
      0x80 | (cp & 0x3f),
    ]
  }
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

/** Categories that render as nothing, or as something misleading, on their own. */
const UNDRAWABLE = new Set<GeneralCategory>(['Cc', 'Cf', 'Zs', 'Zl', 'Zp', 'Cs', 'Co', 'Cn'])

function maskAt(index: UnicodeIndex, cpIndex: number): number {
  const { flagged, masks } = index
  let lo = 0
  let hi = flagged.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = flagged[mid]!
    if (v === cpIndex) return masks[mid]!
    if (v < cpIndex) lo = mid + 1
    else hi = mid - 1
  }
  return 0
}

/** The row for one code point. Out-of-range indices return null. */
export function inspectAt(index: UnicodeIndex, cpIndex: number): CodePointRow | null {
  if (!Number.isInteger(cpIndex) || cpIndex < 0 || cpIndex >= index.codePoints) return null
  const offset = index.offsets[cpIndex]!
  const length = index.offsets[cpIndex + 1]! - offset
  const char = index.text.slice(offset, offset + length)
  const codePoint = char.codePointAt(0)!
  const mask = maskAt(index, cpIndex)
  const category = generalCategory(char)
  const { line, column } = offsetToLineCol(index.lines, offset)

  let utf16 = hex4(char.charCodeAt(0))
  if (length === 2) utf16 += ` ${hex4(char.charCodeAt(1))}`

  const hex = `U+${hex4(codePoint)}`
  let display = char
  let placeholder = false
  // U+FFFD draws as itself, and seeing the � is the useful part.
  if ((mask !== 0 && mask !== FLAG_BIT.replacement) || UNDRAWABLE.has(category)) {
    display = abbreviationOf(codePoint) ?? hex4(codePoint)
    placeholder = true
  } else if (category === 'Mn' || category === 'Me') {
    // A combining mark needs a base to sit on; U+25CC is the conventional one.
    display = `◌${char}`
  }

  return {
    index: cpIndex,
    offset,
    length,
    line,
    column,
    char,
    codePoint,
    hex,
    utf8: utf8Hex(codePoint),
    utf16,
    category,
    categoryName: GENERAL_CATEGORIES[category],
    flags: flagsOf(mask),
    name: nameOf(codePoint),
    display,
    placeholder,
  }
}

/** Rows for code points [start, start + count), clamped to the text. */
export function inspectRange(index: UnicodeIndex, start: number, count: number): CodePointRow[] {
  const out: CodePointRow[] = []
  const from = Math.max(0, Math.floor(start))
  const to = Math.min(index.codePoints, from + Math.max(0, Math.floor(count)))
  for (let i = from; i < to; i++) out.push(inspectAt(index, i)!)
  return out
}

/** Rows for flagged entries [start, start + count): the "flagged only" view. */
export function inspectFlaggedRange(
  index: UnicodeIndex,
  start: number,
  count: number,
): CodePointRow[] {
  const out: CodePointRow[] = []
  const from = Math.max(0, Math.floor(start))
  const to = Math.min(index.flagged.length, from + Math.max(0, Math.floor(count)))
  for (let i = from; i < to; i++) out.push(inspectAt(index, index.flagged[i]!)!)
  return out
}

/** Every row. Fine for a paragraph; for big input, index once and use inspectRange. */
export function inspect(text: string): CodePointRow[] {
  const index = buildIndex(text)
  return inspectRange(index, 0, index.codePoints)
}

export interface FlaggedPosition {
  index: number
  offset: number
  line: number
  column: number
  codePoint: number
  hex: string
  flags: UnicodeFlag[]
  name: string | null
}

export interface UnicodeSummary {
  utf16Units: number
  codePoints: number
  graphemes: number
  utf8Bytes: number
  /** "a\nb\n" is two lines; an empty string is zero. */
  lines: number
  /** Code points carrying each flag. */
  flagCounts: Record<UnicodeFlag, number>
  /** Code points carrying any flag. */
  flaggedCount: number
  positions: FlaggedPosition[]
  /** True when `positions` stopped at `maxPositions`; the counts are always complete. */
  positionsTruncated: boolean
}

export interface SummaryOptions {
  /** Default 10,000: a megabyte of NBSPs should not become a megabyte of objects. */
  maxPositions?: number
}

export function summary(input: string | UnicodeIndex, opts: SummaryOptions = {}): UnicodeSummary {
  const index = typeof input === 'string' ? buildIndex(input) : input
  const { text, flagged, masks } = index
  const maxPositions = opts.maxPositions ?? 10_000

  const flagCounts = Object.fromEntries(UNICODE_FLAGS.map((f) => [f, 0])) as Record<
    UnicodeFlag,
    number
  >
  for (let i = 0; i < masks.length; i++) {
    for (const flag of UNICODE_FLAGS) if ((masks[i]! & FLAG_BIT[flag]) !== 0) flagCounts[flag]++
  }

  const positions: FlaggedPosition[] = []
  const limit = Math.min(flagged.length, Math.max(0, maxPositions))
  for (let i = 0; i < limit; i++) {
    const cpIndex = flagged[i]!
    const offset = index.offsets[cpIndex]!
    const codePoint = text.codePointAt(offset)!
    const { line, column } = offsetToLineCol(index.lines, offset)
    positions.push({
      index: cpIndex,
      offset,
      line,
      column,
      codePoint,
      hex: `U+${hex4(codePoint)}`,
      flags: flagsOf(masks[i]!),
      name: nameOf(codePoint),
    })
  }

  let lines = 0
  if (text !== '') {
    lines = index.lines.lineCount
    // A terminator at the very end opens a line with nothing on it.
    const last = text.charCodeAt(text.length - 1)
    if (last === 0x0a || last === 0x0d) lines--
  }

  return {
    utf16Units: text.length,
    codePoints: index.codePoints,
    graphemes: countGraphemes(text),
    utf8Bytes: index.utf8Bytes,
    lines,
    flagCounts,
    flaggedCount: flagged.length,
    positions,
    positionsTruncated: limit < flagged.length,
  }
}
