export interface Counts {
  lines: number
  nonBlankLines: number
  words: number
  /** What a human means by "characters": emoji and flags count as one. */
  graphemes: number
  codePoints: number
  /** String.length. Differs from codePoints wherever surrogate pairs appear. */
  utf16Units: number
  bytes: number
}

const encoder = new TextEncoder()

/**
 * Segmenters are expensive to construct and cheap to reuse, so they are cached
 * per locale -- the same reasoning as the hoisted Intl.Collator in the list
 * tool's comparators.
 */
const segmenterCache = new Map<string, Intl.Segmenter>()

export function segmenter(
  granularity: 'grapheme' | 'word' | 'sentence',
  locale?: string,
): Intl.Segmenter {
  const key = `${granularity}|${locale ?? ''}`
  let s = segmenterCache.get(key)
  if (!s) {
    s = new Intl.Segmenter(locale, { granularity })
    segmenterCache.set(key, s)
  }
  return s
}

export function countGraphemes(text: string, locale?: string): number {
  let n = 0
  for (const _ of segmenter('grapheme', locale).segment(text)) n++
  return n
}

/**
 * Word count via Intl.Segmenter, not /\s+/.
 *
 * Splitting on whitespace reports an entire Chinese, Japanese or Thai paragraph
 * as a single word, and counts "well-known" as one but "well known" as two.
 * `isWordLike` also excludes punctuation and whitespace segments for free.
 */
export function countWords(text: string, locale?: string): number {
  let n = 0
  for (const seg of segmenter('word', locale).segment(text)) {
    if (seg.isWordLike === true) n++
  }
  return n
}

export function countLines(text: string): { lines: number; nonBlankLines: number } {
  if (text === '') return { lines: 0, nonBlankLines: 0 }
  const parts = text.split(/\r\n|\r|\n/)
  // A terminator at the very end yields a final "" that is not a line.
  const lines = /(\r\n|\r|\n)$/.test(text) ? parts.length - 1 : parts.length
  let nonBlankLines = 0
  for (const line of parts) {
    if (line.trim() !== '') nonBlankLines++
  }
  return { lines, nonBlankLines }
}

export function countBytes(text: string): number {
  return encoder.encode(text).length
}

/**
 * All four meanings of "character" are reported, because they genuinely differ
 * and people need different ones: a database column limit is bytes, a text
 * message limit is code points, and what a user counts by eye is graphemes.
 */
export function countStats(text: string, locale?: string): Counts {
  const { lines, nonBlankLines } = countLines(text)
  return {
    lines,
    nonBlankLines,
    words: countWords(text, locale),
    graphemes: countGraphemes(text, locale),
    codePoints: [...text].length,
    utf16Units: text.length,
    bytes: countBytes(text),
  }
}
