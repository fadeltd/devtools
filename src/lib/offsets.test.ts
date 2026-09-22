import { describe, expect, it } from 'vitest'
import { buildLineIndex, lineColToOffset, lineText, offsetToLineCol, visualColumn } from './offsets'

describe('buildLineIndex / offsetToLineCol', () => {
  it('maps offsets to 1-based line and column', () => {
    const text = 'abc\ndef\nghi'
    const idx = buildLineIndex(text)
    expect(idx.lineCount).toBe(3)
    expect(offsetToLineCol(idx, 0)).toEqual({ line: 1, column: 1 })
    expect(offsetToLineCol(idx, 2)).toEqual({ line: 1, column: 3 })
    expect(offsetToLineCol(idx, 4)).toEqual({ line: 2, column: 1 })
    expect(offsetToLineCol(idx, 10)).toEqual({ line: 3, column: 3 })
  })

  it('handles CRLF without producing phantom lines', () => {
    const idx = buildLineIndex('a\r\nb')
    expect(idx.lineCount).toBe(2)
    expect(offsetToLineCol(idx, 3)).toEqual({ line: 2, column: 1 })
  })

  it('handles lone CR', () => {
    const idx = buildLineIndex('a\rb')
    expect(idx.lineCount).toBe(2)
    expect(offsetToLineCol(idx, 2)).toEqual({ line: 2, column: 1 })
  })

  it('handles empty text', () => {
    const idx = buildLineIndex('')
    expect(idx.lineCount).toBe(1)
    expect(offsetToLineCol(idx, 0)).toEqual({ line: 1, column: 1 })
  })

  it('round-trips through lineColToOffset', () => {
    const text = 'one\ntwo\nthree'
    const idx = buildLineIndex(text)
    for (let o = 0; o < text.length; o++) {
      const { line, column } = offsetToLineCol(idx, o)
      expect(lineColToOffset(idx, line, column)).toBe(o)
    }
  })
})

describe('lineText', () => {
  it('returns a line without its terminator', () => {
    const text = 'alpha\r\nbeta\ngamma'
    const idx = buildLineIndex(text)
    expect(lineText(text, idx, 1)).toBe('alpha')
    expect(lineText(text, idx, 2)).toBe('beta')
    expect(lineText(text, idx, 3)).toBe('gamma')
  })
})

describe('visualColumn', () => {
  it('is identity without tabs', () => {
    expect(visualColumn('abcd', 3)).toBe(3)
  })

  it('expands tabs to the tab stop', () => {
    // "\t\tx" with width 2: the x sits at visual column 5.
    expect(visualColumn('\t\tx', 3, 2)).toBe(5)
    expect(visualColumn('\tx', 2, 4)).toBe(5)
  })

  it('handles a column past the end of the line', () => {
    expect(visualColumn('ab', 99)).toBe(3)
  })
})
