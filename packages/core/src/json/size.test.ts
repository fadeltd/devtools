import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  assessJsonSize,
  JSON_LARGE_BYTES,
  JSON_REFUSE_BYTES,
  jsonSizeTier,
  outputHead,
  utf8Length,
} from './size.ts'

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

describe('jsonSizeTier', () => {
  it('is ok up to the large threshold, inclusive', () => {
    expect(jsonSizeTier(0)).toEqual({ tier: 'ok', bytes: 0, reason: null })
    expect(jsonSizeTier(JSON_LARGE_BYTES).tier).toBe('ok')
  })

  it('is large above it, and says what is switched off', () => {
    const v = jsonSizeTier(20 * 1024 * 1024)
    expect(v.tier).toBe('large')
    expect(v.reason).toBe('Large input (20.0 MB): auto-fixes and embedded-JSON expansion are off.')
    expect(jsonSizeTier(JSON_REFUSE_BYTES).tier).toBe('large')
  })

  it('refuses above the hard limit, with a reason', () => {
    const v = jsonSizeTier(JSON_REFUSE_BYTES + 1)
    expect(v.tier).toBe('refuse')
    expect(v.reason).toMatch(/not parsed/)
  })
})

describe('assessJsonSize', () => {
  it('measures UTF-8 bytes, not UTF-16 units', () => {
    // Just under the threshold in characters, over it in bytes.
    const text = 'é'.repeat(JSON_LARGE_BYTES / 2 + 1)
    expect(text.length).toBeLessThan(JSON_LARGE_BYTES)
    const v = assessJsonSize(text)
    expect(v.bytes).toBe(JSON_LARGE_BYTES + 2)
    expect(v.tier).toBe('large')
  })
})

describe('outputHead', () => {
  it('returns short text whole', () => {
    expect(outputHead('abc', 10)).toEqual({ head: 'abc', omitted: 0 })
    expect(outputHead('abc', 3)).toEqual({ head: 'abc', omitted: 0 })
  })

  it('cuts at a line break near the limit', () => {
    const text = 'aaaa\nbbbb\ncccc'
    expect(outputHead(text, 12)).toEqual({ head: 'aaaa\nbbbb', omitted: 5 })
  })

  it('cuts mid-line when the nearest break would lose most of the head', () => {
    const text = 'a\n' + 'b'.repeat(100)
    const { head, omitted } = outputHead(text, 50)
    expect(head.length).toBe(50)
    expect(head.length + omitted).toBe(text.length)
  })
})
