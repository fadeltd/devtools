import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { foldRanges } from './fold.ts'

/** Non-empty objects and arrays: the ones pretty-printing puts on several lines. */
function countContainers(value: unknown): number {
  if (Array.isArray(value)) return (value.length > 0 ? 1 : 0) + value.reduce<number>((n, v) => n + countContainers(v), 0)
  if (value !== null && typeof value === 'object') {
    const members = Object.values(value)
    return (members.length > 0 ? 1 : 0) + members.reduce<number>((n, v) => n + countContainers(v), 0)
  }
  return 0
}

describe('foldRanges', () => {
  it('finds each multi-line container, inside its brackets', () => {
    const text = JSON.stringify({ a: [1, 2], b: { c: [] }, d: 'x' }, null, 2)
    const ranges = foldRanges(text)
    expect(ranges.map((r) => [text[r.from - 1], text[r.to], r.depth])).toEqual([
      ['{', '}', 0],
      ['[', ']', 1],
      ['{', '}', 1],
    ])
  })

  it('skips single-line containers', () => {
    expect(foldRanges('{"a": [1, 2], "b": {}}')).toEqual([])
    expect(foldRanges('[]\n')).toEqual([])
  })

  it('ignores brackets and quotes inside strings', () => {
    const text = '{\n  "a": "[{\\"}",\n  "b": "\\\\"\n}'
    expect(foldRanges(text)).toEqual([{ from: 1, to: text.length - 1, depth: 0 }])
  })

  it('drops containers shallower than minDepth', () => {
    const text = JSON.stringify({ a: { b: [1] } }, null, 2)
    expect(foldRanges(text, { minDepth: 1 }).map((r) => r.depth)).toEqual([1, 2])
  })

  it('skips a mismatched bracket instead of throwing', () => {
    expect(foldRanges('{\n]\n}')).toEqual([{ from: 1, to: 4, depth: 0 }])
    expect(foldRanges('}\n{')).toEqual([])
  })

  it('matches pretty-printed JSON: one range per non-empty container, properly nested', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.integer({ min: 1, max: 4 }), (value, indent) => {
        const text = JSON.stringify(value, null, indent)
        const ranges = foldRanges(text)
        expect(ranges).toHaveLength(countContainers(value))
        for (const r of ranges) {
          expect('{['.includes(text[r.from - 1]!)).toBe(true)
          expect(text[r.to]).toBe(text[r.from - 1] === '{' ? '}' : ']')
        }
        for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.from).toBeGreaterThan(ranges[i - 1]!.from)
      }),
    )
  })
})
