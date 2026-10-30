import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LINE_ONLY_CHARS, MAX_DIFF_CHARS, MAX_DIFF_LINE_CHARS, assessSize, longestLineOf } from './stats.ts'

describe('longestLineOf', () => {
  it('measures lines without their terminator', () => {
    expect(longestLineOf('')).toBe(0)
    expect(longestLineOf('abc')).toBe(3)
    expect(longestLineOf('abc\n')).toBe(3)
    expect(longestLineOf('a\nbcd\nef')).toBe(3)
    expect(longestLineOf('\n\n')).toBe(0)
  })

  it('agrees with splitting on \\n', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('a', 'b', '\n', '\r') }), (s) => {
        expect(longestLineOf(s)).toBe(Math.max(...s.split('\n').map((l) => l.length)))
      }),
    )
  })
})

describe('assessSize thresholds', () => {
  it('refuses exactly past the longest-line limit', () => {
    expect(assessSize('x'.repeat(MAX_DIFF_LINE_CHARS), '').tier).toBe('ok')
    expect(assessSize('', 'x'.repeat(MAX_DIFF_LINE_CHARS + 1)).tier).toBe('refuse')
  })

  it('refuses a 5 MB single line, the case that hangs CodeMirror', () => {
    const v = assessSize('a'.repeat(5_000_000), 'short')
    expect(v.tier).toBe('refuse')
    expect(v.longestLine).toBe(5_000_000)
  })

  it('turns highlighting off past the line-only size, and refuses past the hard cap', () => {
    const line = 'x'.repeat(99) + '\n'
    const over = (n: number) => line.repeat(Math.ceil((n + 1) / line.length))
    expect(assessSize(over(LINE_ONLY_CHARS), '').tier).toBe('line-only')
    expect(assessSize(over(MAX_DIFF_CHARS), '').tier).toBe('refuse')
  })
})
