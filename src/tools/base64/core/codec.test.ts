import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  HAS_NATIVE_BASE64,
  base64Length,
  base64ToBytes,
  base64ToBytesFallback,
  bytesToBase64,
  bytesToBase64Fallback,
  decodeText,
  encodeText,
  wrap,
} from './codec'

const STD = { alphabet: 'base64' as const, padding: true }
const URL_NOPAD = { alphabet: 'base64url' as const, padding: false }
const LENIENT = { alphabet: 'auto' as const, lenient: true }
const STRICT = { alphabet: 'auto' as const, lenient: false }

describe('UTF-8 correctness — where naive btoa breaks', () => {
  it('encodes non-ASCII text', () => {
    // btoa('é') throws InvalidCharacterError; going via TextEncoder does not.
    expect(encodeText('é', STD)).toBe('w6k=')
  })

  it('round-trips emoji, CJK and combining marks', () => {
    for (const text of ['🎉', '👨‍👩‍👧‍👦', '日本語', 'café', 'café', '🇯🇵']) {
      const encoded = encodeText(text, STD)
      const result = decodeText(encoded, STRICT)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.text).toBe(text)
    }
  })

  it('reports invalid UTF-8 rather than returning replacement characters', () => {
    // 0xFF is never valid UTF-8. A non-fatal decoder would yield U+FFFD and
    // look like success.
    const encoded = bytesToBase64(new Uint8Array([0xff, 0xfe]), STD)
    const result = decodeText(encoded, STRICT)
    expect(result.ok).toBe(false)
    if (!result.ok && result.reason === 'not-utf8') {
      expect([...result.bytes]).toEqual([0xff, 0xfe])
    } else {
      expect.unreachable('expected a not-utf8 result')
    }
  })

  it('handles the empty string', () => {
    expect(encodeText('', STD)).toBe('')
    const r = decodeText('', STRICT)
    expect(r.ok && r.text).toBe('')
  })
})

describe('alphabets and padding', () => {
  it('emits base64url without padding', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe])
    expect(bytesToBase64(bytes, STD)).toBe('+//+')
    expect(bytesToBase64(bytes, URL_NOPAD)).toBe('-__-')
  })

  it('strips padding when asked', () => {
    const bytes = new Uint8Array([104, 105])
    expect(bytesToBase64(bytes, STD)).toBe('aGk=')
    expect(bytesToBase64(bytes, { alphabet: 'base64', padding: false })).toBe('aGk')
  })

  it('auto-detects base64url on decode', () => {
    expect([...base64ToBytes('-__-', LENIENT)]).toEqual([0xfb, 0xff, 0xfe])
  })

  it('re-pads unpadded input', () => {
    expect([...base64ToBytes('aGk', LENIENT)]).toEqual([104, 105])
  })

  it('rejects a non-multiple-of-4 length in strict mode', () => {
    expect(() => base64ToBytes('aGk', STRICT)).toThrow(/multiple of 4/)
  })

  it('rejects a 1-character final chunk in any mode', () => {
    // 1 leftover character cannot encode any byte.
    expect(() => base64ToBytes('aGkgd', LENIENT)).toThrow(/impossible/)
  })
})

describe('large inputs', () => {
  it('encodes past the String.fromCharCode argument limit', () => {
    // A naive fromCharCode(...bytes) throws RangeError around 65k-125k args.
    const bytes = new Uint8Array(300_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    const encoded = bytesToBase64Fallback(bytes, STD)
    expect(encoded.length).toBe(base64Length(bytes.length, true))
    expect([...base64ToBytesFallback(encoded, STRICT)]).toEqual([...bytes])
  })
})

describe('wrap', () => {
  it('wraps at PEM and MIME widths', () => {
    expect(wrap('a'.repeat(10), 4)).toBe('aaaa\naaaa\naa')
    expect(wrap('abc', 4)).toBe('abc')
    expect(wrap('abc', 0)).toBe('abc')
  })
})

describe('base64Length', () => {
  it('matches actual output length', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 1001]) {
      const bytes = new Uint8Array(n)
      expect(bytesToBase64(bytes, STD).length).toBe(base64Length(n, true))
      expect(bytesToBase64(bytes, { alphabet: 'base64', padding: false }).length).toBe(
        base64Length(n, false),
      )
    }
  })
})

describe('properties', () => {
  const bytesArb = fc.uint8Array({ maxLength: 512 })

  it('round-trips any byte array across every alphabet/padding combination', () => {
    fc.assert(
      fc.property(bytesArb, fc.constantFrom('base64', 'base64url'), fc.boolean(), (bytes, alphabet, padding) => {
        const encoded = bytesToBase64(bytes, { alphabet: alphabet as 'base64', padding })
        const decoded = base64ToBytes(encoded, { alphabet: alphabet as 'base64', lenient: true })
        expect([...decoded]).toEqual([...bytes])
      }),
      { numRuns: 300 },
    )
  })

  it('round-trips any text', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const r = decodeText(encodeText(text, STD), STRICT)
        expect(r.ok && r.text).toBe(text)
      }),
      { numRuns: 300 },
    )
  })

  it('fallback and native paths agree', () => {
    // Node currently ships no native API, so this asserts self-consistency
    // here and real equivalence in a browser that has it.
    fc.assert(
      fc.property(bytesArb, fc.constantFrom('base64', 'base64url'), fc.boolean(), (bytes, alphabet, padding) => {
        const o = { alphabet: alphabet as 'base64', padding }
        const viaFallback = bytesToBase64Fallback(bytes, o)
        const viaPublic = bytesToBase64(bytes, o)
        expect(viaPublic).toBe(viaFallback)

        const d = { alphabet: alphabet as 'base64', lenient: true }
        expect([...base64ToBytes(viaPublic, d)]).toEqual([...base64ToBytesFallback(viaFallback, d)])
      }),
      { numRuns: 200 },
    )
  })

  it('records which path is under test', () => {
    expect(typeof HAS_NATIVE_BASE64).toBe('boolean')
  })
})
