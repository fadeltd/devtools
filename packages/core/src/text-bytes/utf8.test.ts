import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { findInvalidUtf8, latin1, scanText } from './utf8.ts'

const b = (...xs: number[]) => new Uint8Array(xs)

function fatalOk(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

describe('findInvalidUtf8', () => {
  it('accepts valid UTF-8 of every length', () => {
    expect(findInvalidUtf8(new TextEncoder().encode('a é € 🎉'))).toBeNull()
    expect(findInvalidUtf8(b())).toBeNull()
  })

  it('locates each kind of damage', () => {
    expect(findInvalidUtf8(b(0xc3, 0x28))).toMatchObject({ offset: 0, length: 1, problem: 'bad-continuation', count: 1 })
    expect(findInvalidUtf8(b(0x61, 0x80))).toMatchObject({ offset: 1, length: 1, problem: 'unexpected-continuation' })
    expect(findInvalidUtf8(b(0x61, 0xff))).toMatchObject({ offset: 1, problem: 'invalid-lead' })
    expect(findInvalidUtf8(b(0x61, 0xe2, 0x82))).toMatchObject({ offset: 1, length: 2, problem: 'truncated' })
  })

  it('rejects overlongs, surrogates and code points past U+10FFFF', () => {
    expect(findInvalidUtf8(b(0xc0, 0xaf))?.problem).toBe('invalid-lead') // overlong '/'
    expect(findInvalidUtf8(b(0xe0, 0x80, 0xaf))?.problem).toBe('bad-continuation') // overlong
    expect(findInvalidUtf8(b(0xed, 0xa0, 0x80))?.problem).toBe('bad-continuation') // U+D800
    expect(findInvalidUtf8(b(0xf4, 0x90, 0x80, 0x80))?.problem).toBe('bad-continuation') // U+110000
  })

  it('counts every invalid sequence and says so', () => {
    const e = findInvalidUtf8(b(0x80, 0x41, 0xff, 0xc3))
    expect(e?.count).toBe(3)
    expect(e?.message).toContain('3 invalid sequences')
  })

  it('agrees with TextDecoder on arbitrary bytes, and everything before the offset decodes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        const e = findInvalidUtf8(bytes)
        expect(e === null).toBe(fatalOk(bytes))
        if (e) expect(fatalOk(bytes.subarray(0, e.offset))).toBe(true)
      }),
    )
  })

  it('places sequence boundaries where TextDecoder puts U+FFFD', () => {
    // Bytes from a range that never forms EF BF BD, so every U+FFFD in the
    // replacement decode is one invalid sequence.
    const noFffd = fc.uint8Array({ maxLength: 64 }).filter((x) => !x.includes(0xef))
    fc.assert(
      fc.property(noFffd, (bytes) => {
        const replaced = new TextDecoder('utf-8').decode(bytes)
        const marks = [...replaced].filter((c) => c === '\uFFFD').length
        expect(findInvalidUtf8(bytes)?.count ?? 0).toBe(marks)
      }),
    )
  })
})

describe('latin1', () => {
  it('maps byte n to U+00nn, including 0x80–0x9F which windows-1252 would remap', () => {
    expect(latin1(b(0x41, 0xc3, 0x80, 0xff))).toBe('AÃ\u0080\u00ff')
  })

  it('survives inputs past the fromCharCode argument limit', () => {
    const big = new Uint8Array(300_000).fill(0x61)
    expect(latin1(big)).toBe('a'.repeat(300_000))
  })
})

describe('scanText', () => {
  it('counts code points and lone surrogates', () => {
    expect(scanText('a🎉é')).toEqual({ codePoints: 3, loneSurrogates: 0 })
    expect(scanText('\uD800x\uDC00')).toEqual({ codePoints: 3, loneSurrogates: 2 })
    expect(scanText('\uD83D')).toEqual({ codePoints: 1, loneSurrogates: 1 })
  })
})
