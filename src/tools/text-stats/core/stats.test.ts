import { describe, expect, it } from 'vitest'
import {
  analyzeText,
  classifyCharacters,
  countParagraphs,
  countSentences,
  formatDuration,
  wordTokens,
} from './stats'

describe('classifyCharacters', () => {
  it('separates letters, digits, punctuation, symbols and whitespace', () => {
    // "Hi, 42! €" -> H,i | 4,2 | , ! | € | two spaces
    const c = classifyCharacters('Hi, 42! €')
    expect(c.letters).toBe(2)
    expect(c.digits).toBe(2)
    expect(c.punctuation).toBe(2)
    expect(c.symbols).toBe(1)
    expect(c.whitespace).toBe(2)
  })

  it('counts accented letters as letters', () => {
    expect(classifyCharacters('héllo').letters).toBe(5)
  })

  it('counts non-Latin scripts as letters', () => {
    expect(classifyCharacters('日本語').letters).toBe(3)
    expect(classifyCharacters('Привет').letters).toBe(6)
  })

  it('handles empty input', () => {
    const c = classifyCharacters('')
    expect(c.letters + c.digits + c.punctuation + c.symbols + c.whitespace + c.other).toBe(0)
  })

  it('classifies every code point exactly once', () => {
    const text = 'Hello, wörld! 123 € 日本 \n\t👍'
    const c = classifyCharacters(text)
    const total = c.letters + c.digits + c.punctuation + c.symbols + c.whitespace + c.other
    expect(total).toBe([...text].length)
  })
})

describe('countSentences', () => {
  it('counts simple sentences', () => {
    expect(countSentences('One. Two. Three.')).toBe(3)
  })

  it('handles ! and ?', () => {
    expect(countSentences('Really? Yes! Fine.')).toBe(3)
  })

  it('does not split on a title abbreviation', () => {
    // Intl's segmenter alone returns 2 here.
    expect(countSentences('Dr. Smith went home.')).toBe(1)
  })

  it('does not split on initials', () => {
    expect(countSentences('J. R. R. Tolkien wrote books.')).toBe(1)
  })

  it('does not split on common abbreviations mid-sentence', () => {
    expect(countSentences('We use Node.js etc. in production.')).toBe(1)
    expect(countSentences('Acme Inc. shipped it.')).toBe(1)
  })

  it('still splits a real sentence that follows an abbreviation', () => {
    expect(countSentences('Dr. Smith went home. He was tired.')).toBe(2)
  })

  it('counts a sentence with no terminator', () => {
    expect(countSentences('no full stop here')).toBe(1)
  })

  it('returns 0 for blank input', () => {
    expect(countSentences('')).toBe(0)
    expect(countSentences('   \n  ')).toBe(0)
  })
})

describe('countParagraphs', () => {
  it('splits on blank lines', () => {
    expect(countParagraphs('One line.\n\nTwo.\n\nThree.')).toBe(3)
  })

  it('treats consecutive lines as one paragraph', () => {
    expect(countParagraphs('line one\nline two\nline three')).toBe(1)
  })

  it('ignores trailing blank lines', () => {
    expect(countParagraphs('only one\n\n\n')).toBe(1)
  })

  it('handles CRLF', () => {
    expect(countParagraphs('one\r\n\r\ntwo')).toBe(2)
  })

  it('returns 0 for blank input', () => {
    expect(countParagraphs('')).toBe(0)
    expect(countParagraphs('\n\n')).toBe(0)
  })
})

describe('wordTokens', () => {
  it('excludes punctuation and whitespace', () => {
    expect(wordTokens('Hello, world!')).toEqual(['Hello', 'world'])
  })

  it('segments CJK, which whitespace splitting cannot', () => {
    // /\s+/ would report this entire string as one word.
    expect(wordTokens('日本語を学ぶ').length).toBeGreaterThan(1)
  })

  it('keeps a hyphenated word intact as its parts', () => {
    expect(wordTokens('well-known')).toEqual(['well', 'known'])
  })
})

describe('analyzeText', () => {
  const sample = 'The quick brown fox.\n\nIt jumped over the lazy dog. Twice!'

  it('counts words, unique words and sentences', () => {
    const s = analyzeText(sample)
    // The quick brown fox | It jumped over the lazy dog | Twice
    expect(s.words.words).toBe(11)
    // "The"/"the" collapse when lowercased, so one fewer unique.
    expect(s.words.uniqueWords).toBe(10)
    expect(s.structure.sentences).toBe(3)
    expect(s.structure.paragraphs).toBe(2)
  })

  it('reports all four meanings of character count', () => {
    const s = analyzeText('a👨‍👩‍👧‍👦')
    expect(s.characters.graphemes).toBe(2)
    expect(s.characters.codePoints).toBe(8)
    expect(s.characters.utf16Units).toBe(12)
    expect(s.characters.bytes).toBe(26)
  })

  it('excludes whitespace on request', () => {
    const s = analyzeText('a b\tc\nd')
    expect(s.characters.graphemes).toBe(7)
    expect(s.characters.graphemesNoWhitespace).toBe(4)
  })

  it('finds the longest word by graphemes', () => {
    expect(analyzeText('hi there extraordinary ok').words.longestWord).toBe('extraordinary')
  })

  it('computes average word length', () => {
    // "ab cd ef" -> three 2-letter words.
    expect(analyzeText('ab cd ef').words.averageWordLength).toBe(2)
  })

  it('measures the longest line', () => {
    expect(analyzeText('ab\nabcd\nabc').structure.longestLineChars).toBe(4)
  })

  it('estimates reading and speaking time', () => {
    const s = analyzeText('word '.repeat(238).trim())
    expect(s.words.words).toBe(238)
    expect(Math.round(s.time.readingSeconds)).toBe(60)
    // Speaking is slower, so it always takes longer than reading.
    expect(s.time.speakingSeconds).toBeGreaterThan(s.time.readingSeconds)
  })

  it('returns zeroed, non-NaN stats for empty input', () => {
    const s = analyzeText('')
    expect(s.empty).toBe(true)
    expect(s.words.words).toBe(0)
    expect(s.words.averageWordLength).toBe(0)
    expect(s.structure.lines).toBe(0)
    expect(Number.isNaN(s.structure.averageLineChars)).toBe(false)
    expect(s.time.readingSeconds).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats sub-second, seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('< 1 sec')
    expect(formatDuration(45)).toBe('45 sec')
    expect(formatDuration(60)).toBe('1 min')
    expect(formatDuration(90)).toBe('1 min 30 sec')
    expect(formatDuration(3660)).toBe('1 hr 1 min')
  })
})
