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

let graphemeSegmenter: Intl.Segmenter | undefined
let wordSegmenter: Intl.Segmenter | undefined

function segmenters(locale?: string) {
  graphemeSegmenter ??= new Intl.Segmenter(locale, { granularity: 'grapheme' })
  wordSegmenter ??= new Intl.Segmenter(locale, { granularity: 'word' })
  return { graphemeSegmenter, wordSegmenter }
}

/**
 * All four meanings of "character" are reported, because they genuinely differ
 * and people need different ones: a database column limit is bytes, a Twitter
 * limit is code points, and what a user counts by eye is graphemes.
 *
 * Words come from Intl.Segmenter, not /\s+/, which reports an entire CJK or
 * Thai paragraph as a single word.
 */
export function countStats(text: string, locale?: string): Counts {
  const { graphemeSegmenter: g, wordSegmenter: w } = segmenters(locale)

  let words = 0
  for (const seg of w.segment(text)) {
    if (seg.isWordLike === true) words++
  }

  let graphemes = 0
  for (const _ of g.segment(text)) graphemes++

  const lines = text === '' ? 0 : text.split(/\r\n|\r|\n/).length - (/(\r\n|\r|\n)$/.test(text) ? 1 : 0)
  let nonBlank = 0
  if (text !== '') {
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (line.trim() !== '') nonBlank++
    }
  }

  return {
    lines,
    nonBlankLines: nonBlank,
    words,
    graphemes,
    codePoints: [...text].length,
    utf16Units: text.length,
    bytes: encoder.encode(text).length,
  }
}
