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

  it('ends a line at \\r\\n, \\n or a lone \\r, as CodeMirror does', () => {
    expect(longestLineOf('abc\r\n')).toBe(3)
    expect(longestLineOf('ab\rcd\ref')).toBe(2)
    expect(longestLineOf('abc\r')).toBe(3)
    // \r\n is one break; \n\r is two.
    expect(longestLineOf('a\r\nbb')).toBe(2)
    expect(longestLineOf('aaa\n\rb')).toBe(3)
    expect(longestLineOf('\r\r\n\n')).toBe(0)
    expect(longestLineOf('x\r' + 'y'.repeat(10) + '\r\nz')).toBe(10)
  })

  it("agrees with splitting on CodeMirror's line separator", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('a', 'b', '\n', '\r', '\r\n') }), (s) => {
        expect(longestLineOf(s)).toBe(Math.max(...s.split(/\r\n?|\n/).map((l) => l.length)))
      }),
    )
  })
})

describe('assessSize thresholds', () => {
  it('refuses exactly past the longest-line limit', () => {
    expect(assessSize('x'.repeat(MAX_DIFF_LINE_CHARS), '').tier).toBe('ok')
    expect(assessSize('', 'x'.repeat(MAX_DIFF_LINE_CHARS + 1)).tier).toBe('refuse')
  })

  it('does not refuse a large file with lone \\r line endings as one long line', () => {
    const classicMac = ('x'.repeat(79) + '\r').repeat(40_000)
    const v = assessSize(classicMac, classicMac.replaceAll('\r', '\r\n'))
    expect(v.tier).toBe('line-only')
    expect(v.longestLine).toBe(79)
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
