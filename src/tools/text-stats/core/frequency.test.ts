import { describe, expect, it } from 'vitest'
import { STOP_WORDS, wordFrequencies } from './frequency'

const base = {
  size: 1 as const,
  caseSensitive: false,
  ignoreStopWords: false,
  minLength: 1,
  limit: 20,
}

describe('wordFrequencies', () => {
  it('counts and ranks single words', () => {
    const r = wordFrequencies('red blue red green red blue', base)
    expect(r[0]).toMatchObject({ phrase: 'red', count: 3 })
    expect(r[1]).toMatchObject({ phrase: 'blue', count: 2 })
    expect(r[2]).toMatchObject({ phrase: 'green', count: 1 })
  })

  it('folds case by default', () => {
    expect(wordFrequencies('Red red RED', base)[0]).toMatchObject({ phrase: 'red', count: 3 })
  })

  it('respects case sensitivity when asked', () => {
    const r = wordFrequencies('Red red', { ...base, caseSensitive: true })
    expect(r).toHaveLength(2)
  })

  it('densities sum to 1', () => {
    const r = wordFrequencies('a b c a b a', { ...base, limit: 100 })
    const total = r.reduce((n, p) => n + p.density, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('filters stop words only when asked', () => {
    const text = 'the cat and the hat'
    expect(wordFrequencies(text, base)[0]?.phrase).toBe('the')

    const filtered = wordFrequencies(text, { ...base, ignoreStopWords: true })
    expect(filtered.map((p) => p.phrase).toSorted()).toEqual(['cat', 'hat'])
  })

  it('filters by minimum length in graphemes', () => {
    const r = wordFrequencies('a bb ccc', { ...base, minLength: 2 })
    expect(r.map((p) => p.phrase).toSorted()).toEqual(['bb', 'ccc'])
  })

  it('honours the limit', () => {
    const r = wordFrequencies('a b c d e', { ...base, limit: 2 })
    expect(r).toHaveLength(2)
  })

  it('breaks count ties alphabetically, so output is deterministic', () => {
    const r = wordFrequencies('zebra apple mango', base)
    expect(r.map((p) => p.phrase)).toEqual(['apple', 'mango', 'zebra'])
  })

  it('returns nothing for blank input', () => {
    expect(wordFrequencies('', base)).toEqual([])
    expect(wordFrequencies('   ', base)).toEqual([])
  })

  it('returns nothing when every token is filtered out', () => {
    expect(wordFrequencies('the and of', { ...base, ignoreStopWords: true })).toEqual([])
  })

  describe('phrases', () => {
    it('counts two-word phrases', () => {
      const r = wordFrequencies('new york new york new jersey', { ...base, size: 2 })
      expect(r[0]).toMatchObject({ phrase: 'new york', count: 2 })
    })

    it('counts three-word phrases', () => {
      const r = wordFrequencies('a b c a b c', { ...base, size: 3 })
      expect(r[0]).toMatchObject({ phrase: 'a b c', count: 2 })
    })

    it('windows over the filtered stream, so phrases are not padded with stop words', () => {
      const r = wordFrequencies('speed of light and speed of sound', {
        ...base,
        size: 2,
        ignoreStopWords: true,
      })
      // After filtering: speed light speed sound
      expect(r.map((p) => p.phrase)).toContain('speed light')
      expect(r.map((p) => p.phrase)).not.toContain('speed of')
    })

    it('yields nothing when the text is shorter than the window', () => {
      expect(wordFrequencies('one', { ...base, size: 3 })).toEqual([])
    })
  })
})

describe('STOP_WORDS', () => {
  it('is conservative: it excludes meaningful short words', () => {
    // A list that swallows these would hide real results in a counting tool.
    for (const word of ['api', 'key', 'bug', 'log', 'run', 'get', 'set', 'new']) {
      expect(STOP_WORDS.has(word)).toBe(false)
    }
  })

  it('contains the obvious function words', () => {
    for (const word of ['the', 'and', 'of', 'is', 'to']) {
      expect(STOP_WORDS.has(word)).toBe(true)
    }
  })
})
