import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../random/random.ts'
import {
  LOREM_LIMITS,
  LOREM_WORDS,
  clampLoremCount,
  generateLorem,
  type LoremFormat,
  type LoremOptions,
  type LoremUnit,
} from './lorem.ts'

const base: LoremOptions = { count: 3, unit: 'paragraphs', format: 'text', startWithLorem: true }
const gen = (opts: Partial<LoremOptions>, seed = 1) => generateLorem({ ...base, ...opts }, mulberry32(seed))

/** Back to bare words, whatever the format. */
const plain = (s: string) => s.replace(/<\/?p>|\*/g, '')
const countWords = (s: string) => plain(s).split(/\s+/).filter(Boolean).length
const countSentences = (s: string) => (plain(s).match(/\./g) ?? []).length
const paragraphsOf = (s: string, format: LoremFormat) =>
  s === '' ? [] : format === 'html' ? s.split('\n') : s.split('\n\n')

describe('generateLorem', () => {
  it('gives exact counts in every unit and format', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.constantFrom<LoremUnit>('words', 'sentences', 'paragraphs'),
        fc.constantFrom<LoremFormat>('text', 'html', 'markdown'),
        fc.boolean(),
        fc.integer(),
        (count, unit, format, startWithLorem, seed) => {
          const r = generateLorem({ count, unit, format, startWithLorem }, mulberry32(seed))
          expect(r.count).toBe(count)
          expect(countWords(r.output)).toBe(r.words)
          expect(countSentences(r.output)).toBe(r.sentences)
          expect(paragraphsOf(r.output, format)).toHaveLength(r.paragraphs)
          const exact = unit === 'words' ? r.words : unit === 'sentences' ? r.sentences : r.paragraphs
          expect(exact).toBe(count)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('gives the same text for the same seed, and different text for another', () => {
    expect(gen({}, 42).output).toBe(gen({}, 42).output)
    expect(gen({}, 42).output).not.toBe(gen({}, 43).output)
  })

  it('is pinned for a fixed seed', () => {
    expect(gen({ unit: 'sentences', count: 3, startWithLorem: false }, 7).output).toBe(
      'Nisl minim adipiscing ut ultricies laborum excepteur. Do amet sit cupidatat tellus, ante cupidatat fermentum est dapibus. Faucibus a in fugiat vestibulum convallis mauris exercitation pulvinar velit, ultricies posuere.',
    )
  })

  it('gives the same words in every format for one seed', () => {
    const text = gen({ format: 'text' }, 9).output
    expect(plain(gen({ format: 'markdown' }, 9).output)).toBe(text)
    expect(gen({ format: 'html' }, 9).output).toBe(
      text
        .split('\n\n')
        .map((p) => `<p>${p}</p>`)
        .join('\n'),
    )
  })

  it('starts with the classic sentence on request', () => {
    expect(gen({ unit: 'sentences', count: 1 }).output).toBe('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
    expect(gen({ unit: 'paragraphs', count: 2 }).output).toMatch(/^Lorem ipsum dolor sit amet, consectetur adipiscing elit\. [A-Z]/)
    expect(gen({ unit: 'sentences', count: 3, startWithLorem: false }).output.startsWith('Lorem ipsum dolor sit amet,')).toBe(false)
  })

  it('cuts the classic sentence short for a few words, without a dangling comma', () => {
    expect(gen({ unit: 'words', count: 2 }).output).toBe('Lorem ipsum.')
    expect(gen({ unit: 'words', count: 5 }).output).toBe('Lorem ipsum dolor sit amet.')
    expect(gen({ unit: 'words', count: 6 }).output).toBe('Lorem ipsum dolor sit amet, consectetur.')
  })

  it('wraps HTML paragraphs in <p>, one per line', () => {
    const out = gen({ format: 'html', count: 2 }).output
    expect(out.split('\n')).toHaveLength(2)
    expect(out).toMatch(/^<p>Lorem .*<\/p>\n<p>[A-Z].*<\/p>$/)
  })

  it('emphasises the odd word in Markdown, never the first of a sentence', () => {
    const out = gen({ format: 'markdown', count: 20 }).output
    expect(out).toMatch(/\*\*[a-z]+\*\*/)
    expect(out).toMatch(/(?<!\*)\*[a-z]+\*(?!\*)/)
    expect(out).not.toMatch(/(?:^|\. )\*/m)
  })

  it('caps each unit and says so', () => {
    const r = gen({ unit: 'paragraphs', count: 5000 })
    expect(r).toMatchObject({ count: 1000, capped: true, paragraphs: 1000 })
    expect(gen({ unit: 'words', count: 1e9 })).toMatchObject({ count: LOREM_LIMITS.words, capped: true })
  })

  it('treats zero, negative and unparseable counts as nothing', () => {
    for (const count of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(gen({ count })).toMatchObject({ output: '', count: 0, capped: false, words: 0 })
    }
  })

  it('never repeats a word back to back by chance more than the redraw allows', () => {
    const words = plain(gen({ unit: 'words', count: 5000 }, 3).output).toLowerCase().split(/[\s,.]+/)
    let repeats = 0
    for (let i = 1; i < words.length; i++) if (words[i] === words[i - 1]) repeats++
    // One redraw leaves a 1-in-~180² chance per pair.
    expect(repeats).toBeLessThan(5)
  })
})

describe('clampLoremCount', () => {
  it('floors fractions', () => {
    expect(clampLoremCount(2.9, 'words')).toEqual({ count: 2, capped: false })
  })
})

describe('LOREM_WORDS', () => {
  it('has no duplicates and nothing a format would need to escape', () => {
    expect(new Set(LOREM_WORDS).size).toBe(LOREM_WORDS.length)
    for (const w of LOREM_WORDS) expect(w).toMatch(/^[a-z]+$/)
  })
})
