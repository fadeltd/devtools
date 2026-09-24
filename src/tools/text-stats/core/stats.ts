import {
  countBytes,
  countGraphemes,
  countLines,
  countWords,
  segmenter,
} from '@/lib/text/counts'

export interface CharacterCounts {
  /** What a human means by "characters": an emoji family is one. */
  graphemes: number
  /** Graphemes with whitespace removed -- the classic "excluding spaces". */
  graphemesNoWhitespace: number
  codePoints: number
  /** String.length. Differs from codePoints wherever surrogate pairs appear. */
  utf16Units: number
  bytes: number
}

export interface CharacterClasses {
  letters: number
  digits: number
  punctuation: number
  symbols: number
  whitespace: number
  other: number
}

export interface StructureCounts {
  lines: number
  nonBlankLines: number
  sentences: number
  paragraphs: number
  longestLineChars: number
  averageLineChars: number
}

export interface WordCounts {
  words: number
  uniqueWords: number
  averageWordLength: number
  longestWord: string
}

export interface ReadingTime {
  /** Silent reading, 238 wpm (Brysbaert 2019 meta-analysis, English prose). */
  readingSeconds: number
  /** Reading aloud, ~150 wpm. */
  speakingSeconds: number
}

export interface TextStats {
  characters: CharacterCounts
  classes: CharacterClasses
  words: WordCounts
  structure: StructureCounts
  time: ReadingTime
  empty: boolean
}

const RE_LETTER = /\p{L}/u
const RE_DIGIT = /\p{N}/u
const RE_PUNCT = /\p{P}/u
const RE_SYMBOL = /\p{S}/u
const RE_WHITESPACE = /\s/u

/**
 * Classify by code point, not by grapheme: a grapheme cluster can mix classes
 * (a letter plus a combining mark), and "how many letters" means base letters.
 */
export function classifyCharacters(text: string): CharacterClasses {
  const out: CharacterClasses = {
    letters: 0,
    digits: 0,
    punctuation: 0,
    symbols: 0,
    whitespace: 0,
    other: 0,
  }
  for (const ch of text) {
    if (RE_WHITESPACE.test(ch)) out.whitespace++
    else if (RE_LETTER.test(ch)) out.letters++
    else if (RE_DIGIT.test(ch)) out.digits++
    else if (RE_PUNCT.test(ch)) out.punctuation++
    else if (RE_SYMBOL.test(ch)) out.symbols++
    else out.other++
  }
  return out
}

/**
 * Abbreviations that end in a period without ending a sentence.
 *
 * Intl's sentence segmenter breaks "Dr. Smith went home." into two sentences.
 * That is not a bug we can configure away, so we re-join segments whose last
 * token is a known abbreviation or a single-letter initial ("J. R. R. Tolkien").
 */
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'mt', 'rev', 'hon',
  'inc', 'ltd', 'co', 'corp', 'dept', 'est', 'fig', 'no', 'vol', 'pp',
  'approx', 'appt', 'apt', 'ave', 'blvd', 'rd', 'vs', 'etc', 'al',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'e.g', 'i.e', 'a.m', 'p.m', 'u.s', 'u.k',
])

function endsWithAbbreviation(segment: string): boolean {
  const trimmed = segment.trimEnd()
  if (!trimmed.endsWith('.')) return false
  const lastToken = /([\p{L}.]+)\.$/u.exec(trimmed)?.[1]
  if (lastToken === undefined) return false
  const normalized = lastToken.toLowerCase().replace(/\.$/, '')
  // A single letter is an initial, e.g. the "J." in "J. R. R. Tolkien".
  if (normalized.length === 1) return true
  return ABBREVIATIONS.has(normalized)
}

export function countSentences(text: string, locale?: string): number {
  if (text.trim() === '') return 0

  let sentences = 0
  let pendingJoin = false

  for (const seg of segmenter('sentence', locale).segment(text)) {
    if (seg.segment.trim() === '') continue
    if (!pendingJoin) sentences++
    pendingJoin = endsWithAbbreviation(seg.segment)
  }

  return sentences
}

/** Blocks separated by one or more blank lines. */
export function countParagraphs(text: string): number {
  if (text.trim() === '') return 0
  return text
    .split(/(?:\r\n|\r|\n)\s*(?:\r\n|\r|\n)/)
    .filter((block) => block.trim() !== '').length
}

/** Word-like segments, lowercased, for uniqueness and frequency. */
export function wordTokens(text: string, locale?: string): string[] {
  const out: string[] = []
  for (const seg of segmenter('word', locale).segment(text)) {
    if (seg.isWordLike === true) out.push(seg.segment)
  }
  return out
}

const WORDS_PER_MINUTE_READING = 238
const WORDS_PER_MINUTE_SPEAKING = 150

export function analyzeText(text: string, locale?: string): TextStats {
  const { lines, nonBlankLines } = countLines(text)
  const tokens = wordTokens(text, locale)

  const unique = new Set<string>()
  let totalWordLength = 0
  let longestWord = ''
  for (const token of tokens) {
    unique.add(token.toLowerCase())
    // Grapheme length, so an emoji or accented word is not over-counted.
    const length = countGraphemes(token, locale)
    totalWordLength += length
    if (length > countGraphemes(longestWord, locale)) longestWord = token
  }

  let longestLineChars = 0
  let totalLineChars = 0
  const lineList = text === '' ? [] : text.split(/\r\n|\r|\n/)
  for (const line of lineList) {
    const length = countGraphemes(line, locale)
    totalLineChars += length
    if (length > longestLineChars) longestLineChars = length
  }

  const words = tokens.length

  return {
    characters: {
      graphemes: countGraphemes(text, locale),
      graphemesNoWhitespace: countGraphemes(text.replace(/\s/gu, ''), locale),
      codePoints: [...text].length,
      utf16Units: text.length,
      bytes: countBytes(text),
    },
    classes: classifyCharacters(text),
    words: {
      words,
      uniqueWords: unique.size,
      averageWordLength: words === 0 ? 0 : totalWordLength / words,
      longestWord,
    },
    structure: {
      lines,
      nonBlankLines,
      sentences: countSentences(text, locale),
      paragraphs: countParagraphs(text),
      longestLineChars,
      averageLineChars: lines === 0 ? 0 : totalLineChars / Math.max(1, lineList.length),
    },
    time: {
      readingSeconds: (words / WORDS_PER_MINUTE_READING) * 60,
      speakingSeconds: (words / WORDS_PER_MINUTE_SPEAKING) * 60,
    },
    empty: text === '',
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return '< 1 sec'
  const rounded = Math.round(seconds)
  if (rounded < 60) return `${rounded} sec`
  const minutes = Math.floor(rounded / 60)
  const rest = rounded % 60
  if (minutes < 60) return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} sec`
  const hours = Math.floor(minutes / 60)
  return `${hours} hr ${minutes % 60} min`
}

/** `countWords` is re-exported so callers do not reach past this module. */
export { countWords }
