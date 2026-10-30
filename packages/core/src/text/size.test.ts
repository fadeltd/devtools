import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { hasLongLine, utf8Length } from './size.ts'

const encoder = new TextEncoder()

describe('utf8Length', () => {
  it('counts ASCII as one byte per character', () => {
    expect(utf8Length('')).toBe(0)
    expect(utf8Length('{"a":1}')).toBe(7)
  })

  it('counts 2-, 3- and 4-byte sequences', () => {
    expect(utf8Length('é')).toBe(2)
    expect(utf8Length('中')).toBe(3)
    expect(utf8Length('😀')).toBe(4)
    expect(utf8Length('a😀é中b')).toBe(11)
  })

  it('counts a lone surrogate as the 3-byte replacement character', () => {
    expect(utf8Length('\uD83D')).toBe(3)
    expect(utf8Length('\uDE00')).toBe(3)
    expect(utf8Length('a\uD83Db')).toBe(5)
    expect(utf8Length('\uDE00\uD83D')).toBe(6)
  })

  it('agrees with TextEncoder on any string, lone surrogates included', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect(utf8Length(s)).toBe(encoder.encode(s).length)
      }),
    )
  })
})

describe('hasLongLine', () => {
  it('finds a line past the limit, wherever it is', () => {
    expect(hasLongLine('', 3)).toBe(false)
    expect(hasLongLine('abc', 3)).toBe(false)
    expect(hasLongLine('abcd', 3)).toBe(true)
    expect(hasLongLine('ab\nabcd\nx', 3)).toBe(true)
    expect(hasLongLine('abc\nabc\nabc', 3)).toBe(false)
    expect(hasLongLine('ab\n\nabcd', 3)).toBe(true)
  })

  it('agrees with splitting on newlines', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('a', 'b', '\n') }), fc.nat(8), (s, limit) => {
        expect(hasLongLine(s, limit)).toBe(s.split('\n').some((l) => l.length > limit))
      }),
    )
  })
})
