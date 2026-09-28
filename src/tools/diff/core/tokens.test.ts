import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { splitLines, splitWords } from './tokens'

// Small alphabet so line breaks, lone CRs, combining marks and astral code
// points all turn up often.
const textArb = fc.string({
  unit: fc.constantFrom('a', 'Z', '1', '_', '.', ' ', '\t', '\n', '\r', 'é', 'é', '😀'),
  maxLength: 40,
})

describe('splitLines', () => {
  it('keeps terminators and has no phantom trailing line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a\n', 'b\n'])
  })

  it('keeps a final line without a terminator', () => {
    expect(splitLines('a\nb')).toEqual(['a\n', 'b'])
  })

  it('keeps \\r\\n together on its line', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a\r\n', 'b\r\n'])
  })

  it('has no lines for empty input', () => {
    expect(splitLines('')).toEqual([])
  })

  it('round-trips any string', () => {
    fc.assert(fc.property(textArb, (s) => splitLines(s).join('') === s))
    fc.assert(fc.property(fc.string({ unit: 'binary' }), (s) => splitLines(s).join('') === s))
  })

  it('only ever breaks after \\n', () => {
    fc.assert(
      fc.property(textArb, (s) => {
        const lines = splitLines(s)
        return lines.every((l, i) => {
          const body = l.endsWith('\n') ? l.slice(0, -1) : l
          const isLast = i === lines.length - 1
          return !body.includes('\n') && (l.endsWith('\n') || isLast) && l !== ''
        })
      }),
    )
  })
})

describe('splitWords', () => {
  it('splits words, whitespace runs, line breaks and punctuation', () => {
    expect(splitWords('foo_bar  baz.qux\r\n')).toEqual(['foo_bar', '  ', 'baz', '.', 'qux', '\r\n'])
  })

  it('keeps a combining mark inside its word', () => {
    expect(splitWords('éx y')).toEqual(['éx', ' ', 'y'])
  })

  it('keeps an astral code point whole', () => {
    expect(splitWords('a😀b')).toEqual(['a', '😀', 'b'])
  })

  it('has no tokens for empty input', () => {
    expect(splitWords('')).toEqual([])
  })

  it('round-trips any string', () => {
    fc.assert(fc.property(textArb, (s) => splitWords(s).join('') === s))
    fc.assert(fc.property(fc.string({ unit: 'binary' }), (s) => splitWords(s).join('') === s))
  })
})
