import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { inspectInput, stripTrailingNewline } from './input.ts'

describe('inspectInput', () => {
  it('reports nothing for clean text', () => {
    expect(inspectInput('abc')).toEqual({ crlf: 0, trailingNewlines: 0, loneSurrogates: false })
    expect(inspectInput('')).toEqual({ crlf: 0, trailingNewlines: 0, loneSurrogates: false })
  })

  it('counts CRLF pairs, not bare CR or LF', () => {
    expect(inspectInput('a\r\nb\r\nc').crlf).toBe(2)
    expect(inspectInput('a\nb\rc').crlf).toBe(0)
    expect(inspectInput('\r\n\r\n').crlf).toBe(2)
  })

  it('counts trailing newlines of either kind', () => {
    expect(inspectInput('abc\n').trailingNewlines).toBe(1)
    expect(inspectInput('abc\r\n').trailingNewlines).toBe(1)
    expect(inspectInput('abc\n\r\n\n').trailingNewlines).toBe(3)
    expect(inspectInput('\n').trailingNewlines).toBe(1)
    expect(inspectInput('abc\r').trailingNewlines).toBe(0)
  })

  it('flags lone surrogates, which UTF-8 encoding silently replaces', () => {
    expect(inspectInput('a\uD83Db').loneSurrogates).toBe(true)
    expect(inspectInput('a\uDE00').loneSurrogates).toBe(true)
    expect(inspectInput('🎉').loneSurrogates).toBe(false)
  })
})

describe('stripTrailingNewline', () => {
  it('removes exactly one LF or CRLF', () => {
    expect(stripTrailingNewline('abc\n')).toBe('abc')
    expect(stripTrailingNewline('abc\r\n')).toBe('abc')
    expect(stripTrailingNewline('abc\n\n')).toBe('abc\n')
    expect(stripTrailingNewline('abc')).toBe('abc')
    expect(stripTrailingNewline('abc\r')).toBe('abc\r')
    expect(stripTrailingNewline('')).toBe('')
  })

  it('is the inverse of echo for any text not already ending in a line break', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        // A trailing \r plus echo's \n is a CRLF, which is stripped whole.
        fc.pre(!s.endsWith('\n') && !s.endsWith('\r'))
        expect(stripTrailingNewline(`${s}\n`)).toBe(s)
      }),
    )
  })
})
