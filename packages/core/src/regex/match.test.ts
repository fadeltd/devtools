import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { findMatches } from './match.ts'

describe('findMatches', () => {
  it('finds every match with g, with position and groups', () => {
    const r = findMatches('2024-10-30\nand 1999-01-02', /(?<year>\d{4})-(\d{2})/g)
    expect(r.truncated).toBe(false)
    expect(r.groupNames).toEqual(['year', null])
    expect(r.matches.map((m) => [m.text, m.line, m.column])).toEqual([
      ['2024-10', 1, 1],
      ['1999-01', 2, 5],
    ])
    expect(r.matches[1]!.groups).toEqual([
      { number: 1, name: 'year', text: '1999', start: 15, end: 19 },
      { number: 2, name: null, text: '01', start: 20, end: 22 },
    ])
  })

  it('finds only the first match without g', () => {
    expect(findMatches('a a a', /a/).matches).toHaveLength(1)
  })

  it('reports a group that did not take part as null', () => {
    const [m] = findMatches('b', /(a)?b/g).matches
    expect(m!.groups[0]).toEqual({ number: 1, name: null, text: null, start: null, end: null })
  })

  it('steps over empty matches, by code point in unicode mode', () => {
    expect(findMatches('baa', /a*/g).matches.map((m) => [m.start, m.text])).toEqual([
      [0, ''],
      [1, 'aa'],
      [3, ''],
    ])
    expect(findMatches('😀', /(?:)/gu).matches.map((m) => m.start)).toEqual([0, 2])
    expect(findMatches('😀', /(?:)/g).matches.map((m) => m.start)).toEqual([0, 1, 2])
  })

  it('stops at the first gap with g and y', () => {
    expect(findMatches('aab a', /a/gy).matches).toHaveLength(2)
  })

  it('stops at the limit and says so', () => {
    const r = findMatches('aaaa', /a/g, { limit: 3 })
    expect(r.matches).toHaveLength(3)
    expect(r.truncated).toBe(true)
    expect(findMatches('aaa', /a/g, { limit: 3 }).truncated).toBe(false)
  })

  it('does not touch the lastIndex of the regex it is given', () => {
    const re = /a/g
    re.lastIndex = 2
    findMatches('aaa', re)
    expect(re.lastIndex).toBe(2)
  })

  it('agrees with matchAll', () => {
    const patterns = ['a', 'a*', 'b|', '(a)(b)?', '(?<x>[ab])\\1', '^', '$', '\\b', '.', '(?:)', '[^a]+']
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom('a', 'b', ' ', '\n', '😀') }),
        fc.constantFrom(...patterns),
        fc.constantFrom('g', 'gm', 'gu', 'gi', 'gs', 'gmu'),
        (text, pattern, flags) => {
          const re = new RegExp(pattern, flags)
          const expected = [...text.matchAll(re)].map((m) => [m.index, m[0], m.slice(1).map((g) => g ?? null)])
          const actual = findMatches(text, re).matches.map((m) => [m.start, m.text, m.groups.map((g) => g.text)])
          expect(actual).toEqual(expected)
        },
      ),
    )
  })
})
