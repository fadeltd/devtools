import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  countEscapes,
  decode,
  decodeOptionsFor,
  detectDoubleEncoding,
  encode,
  findLoneSurrogate,
  locate,
  toWellFormed,
  type DecodeResult,
  type Variant,
} from './codec.ts'

const VARIANTS: Variant[] = ['component', 'uri', 'form']
const STRICT = { plusAsSpace: false, keepReserved: false, lenient: false }
const LENIENT = { ...STRICT, lenient: true }
const FORM = { ...STRICT, plusAsSpace: true }

function out(r: DecodeResult): string {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.message}`)
  return r.output
}

function enc(s: string, v: Variant): string {
  const r = encode(s, v)
  if (!r.ok) throw new Error(r.error.message)
  return r.output
}

/** Well-formed strings: astral code points come as proper pairs. */
const wellFormed = fc.string({ unit: 'binary', maxLength: 60 })

describe('encode', () => {
  it('component matches encodeURIComponent', () => {
    expect(enc('a b&c=d/é?#', 'component')).toBe('a%20b%26c%3Dd%2F%C3%A9%3F%23')
    fc.assert(fc.property(wellFormed, (s) => enc(s, 'component') === encodeURIComponent(s)))
  })

  it('uri matches encodeURI and keeps the URL structure', () => {
    expect(enc('https://x.dev/a b?q=1&r=é#top', 'uri')).toBe('https://x.dev/a%20b?q=1&r=%C3%A9#top')
    fc.assert(fc.property(wellFormed, (s) => enc(s, 'uri') === encodeURI(s)))
  })

  it('form matches URLSearchParams exactly, character set and all', () => {
    expect(enc("a b+c!'()~*-._", 'form')).toBe('a+b%2Bc%21%27%28%29%7E*-._')
    fc.assert(
      fc.property(wellFormed, (s) => `a=${enc(s, 'form')}` === new URLSearchParams([['a', s]]).toString()),
    )
  })

  it('encodes emoji as four UTF-8 bytes', () => {
    expect(enc('🎉', 'component')).toBe('%F0%9F%8E%89')
    expect(enc('👨‍👩‍👧', 'form')).toBe('%F0%9F%91%A8%E2%80%8D%F0%9F%91%A9%E2%80%8D%F0%9F%91%A7')
  })

  it('reports a lone surrogate with its position instead of throwing', () => {
    for (const v of VARIANTS) {
      const r = encode('ab\uD83Dcd', v)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error.index).toBe(2)
        expect(r.error.codeUnit).toBe('U+D83D')
        expect(r.error.message).toContain('position 3')
      }
    }
  })

  it('finds a lone low surrogate, and one at the very end', () => {
    expect(findLoneSurrogate('\uDE00x')?.index).toBe(0)
    expect(findLoneSurrogate('x\uD83D')?.index).toBe(1)
    expect(findLoneSurrogate('😀😀')).toBeNull()
    // Reversed pair: two lone surrogates.
    expect(findLoneSurrogate('\uDE00\uD83D')?.count).toBe(2)
  })

  it('reports line and column on multi-line input', () => {
    const r = findLoneSurrogate('one\ntwo\uD800')
    expect(r).toMatchObject({ index: 7, line: 2, column: 4 })
    expect(r?.message).toContain('line 2, column 4')
  })

  it('toWellFormed swaps lone surrogates for U+FFFD and leaves pairs alone', () => {
    expect(toWellFormed('a\uD800b😀\uDC00')).toBe('a�b😀�')
    expect(toWellFormed('plain')).toBe('plain')
  })
})

describe('decode', () => {
  it('round-trips every well-formed string in every variant', () => {
    fc.assert(
      fc.property(wellFormed, fc.constantFrom(...VARIANTS), (s, v) => {
        return out(decode(enc(s, v), decodeOptionsFor(v, false))) === s
      }),
    )
  })

  // Strings built from fragments that hit every branch: good and bad escapes,
  // reserved characters, truncated and invalid UTF-8, encoded surrogates.
  const messy = fc
    .array(
      fc.constantFrom(
        '%', '2', '5', 'E', 'e', '8', 'A', 'f', 'G', 'x', '+', '/', 'é', ' ', '😀',
        '%41', '%2F', '%2f', '%3B', '%23', '%2B', '%25', '%E2%82%AC', '%e2%82', '%F0%9F%98%80',
        '%ED%A0%80', '%C0%80', '%FF', '%F4%90%80%80', '%80', '%C3',
      ),
      { maxLength: 12 },
    )
    .map((parts) => parts.join(''))

  it('agrees with decodeURIComponent: same output, or an error exactly when it throws', () => {
    fc.assert(
      fc.property(messy, (s) => {
        let native: string | null = null
        try {
          native = decodeURIComponent(s)
        } catch {
          native = null
        }
        const r = decode(s, STRICT)
        return native === null ? !r.ok : r.ok && r.output === native
      }),
      { numRuns: 2000 },
    )
  })

  it('with keepReserved, agrees with decodeURI', () => {
    const opts = decodeOptionsFor('uri', false)
    fc.assert(
      fc.property(messy, (s) => {
        let native: string | null = null
        try {
          native = decodeURI(s)
        } catch {
          native = null
        }
        const r = decode(s, opts)
        return native === null ? !r.ok : r.ok && r.output === native
      }),
      { numRuns: 2000 },
    )
    expect(out(decode('a%2Fb%2fc%20d', opts))).toBe('a%2Fb%2fc d')
  })

  it('lenient mode never fails, and on valid input matches strict mode', () => {
    fc.assert(
      fc.property(messy, (s) => {
        const lenient = decode(s, LENIENT)
        const strict = decode(s, STRICT)
        if (!lenient.ok) return false
        return strict.ok ? lenient.output === strict.output && lenient.skipped === 0 : lenient.skipped > 0
      }),
      { numRuns: 2000 },
    )
  })

  it.each([
    ['%', 0, '%', 'bad-escape'],
    ['abc%', 3, '%', 'bad-escape'],
    ['%G1', 0, '%G1', 'bad-escape'],
    ['ok%4', 2, '%4', 'bad-escape'],
    ['%4%41', 0, '%4', 'bad-escape'],
    ['x%E2%82', 1, '%E2%82', 'truncated-utf8'],
    ['%E2%82x', 0, '%E2%82', 'truncated-utf8'],
    ['%F0%9F%98', 0, '%F0%9F%98', 'truncated-utf8'],
    ['%FF', 0, '%FF', 'invalid-utf8'],
    ['%80', 0, '%80', 'invalid-utf8'],
    ['%C0%80', 0, '%C0', 'invalid-utf8'],
    ['%E2%28%A1', 0, '%E2', 'invalid-utf8'],
    ['%ED%A0%80', 0, '%ED', 'invalid-utf8'],
    ['%F4%90%80%80', 0, '%F4', 'invalid-utf8'],
    ['%41%42%E2%82%41', 6, '%E2%82', 'invalid-utf8'],
  ])('reports %j at index %i as %j (%s)', (input, index, sequence, kind) => {
    const r = decode(input, STRICT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatchObject({ index, sequence, kind })
      expect(r.error.message).toContain(`position ${index + 1}`)
    }
  })

  it('reports the first bad sequence when there are several', () => {
    const r = decode('a%20%ZZ%FF', STRICT)
    expect(!r.ok && r.error.index).toBe(4)
  })

  it('lenient leaves bad sequences verbatim and counts them', () => {
    const r = decode('%41%E2%82%20%G1%FF😀%F0%9F%98%80', LENIENT)
    expect(r).toMatchObject({ ok: true, output: 'A%E2%82 %G1%FF😀😀', skipped: 3 })
    // E2 82 followed by 20: the run continues, but 0x20 cannot continue it.
    expect(r.ok && r.firstSkipped).toMatchObject({ index: 3, sequence: '%E2%82', kind: 'invalid-utf8' })
  })

  it('lenient keeps only the % of a bad escape, so what follows is still decoded', () => {
    expect(out(decode('%%41', LENIENT))).toBe('%A')
    expect(out(decode('%+1', { ...LENIENT, plusAsSpace: true }))).toBe('% 1')
  })

  it('treats + as a space only in form mode, and %2B is always a plus', () => {
    expect(out(decode('a+b%2Bc', STRICT))).toBe('a+b+c')
    expect(out(decode('a+b%2Bc', FORM))).toBe('a b+c')
    expect(out(decode('++', FORM))).toBe('  ')
  })

  it('decodes emoji, mixed-case hex and literal non-ASCII', () => {
    expect(out(decode('%F0%9F%8E%89', STRICT))).toBe('🎉')
    expect(out(decode('%c3%a9t%C3%A9', STRICT))).toBe('été')
    expect(out(decode('déjà%20vu', STRICT))).toBe('déjà vu')
  })

  it('decodes a string with no escapes to itself', () => {
    expect(out(decode('', STRICT))).toBe('')
    expect(out(decode('plain-text_123', STRICT))).toBe('plain-text_123')
  })

  it('decodes a large input in one pass', () => {
    const big = '%E2%82%AC'.repeat(100_000)
    expect(out(decode(big, STRICT))).toBe('€'.repeat(100_000))
    const r = decode('%FF'.repeat(100_000), LENIENT)
    expect(r.ok && r.skipped).toBe(100_000)
  })
})

describe('double encoding', () => {
  it('detects %25 followed by two hex digits', () => {
    expect(detectDoubleEncoding('a%2520b%252F')).toMatchObject({
      index: 1,
      sample: '%2520',
      decodesTo: '%20',
      count: 2,
    })
  })

  it('ignores a single encode and a bare %25', () => {
    expect(detectDoubleEncoding('a%20b')).toBeNull()
    expect(detectDoubleEncoding('100%25 sure')).toBeNull()
    expect(detectDoubleEncoding('%25zz')).toBeNull()
  })

  it('is what encoding twice produces', () => {
    const twice = enc(enc('a b/c', 'component'), 'component')
    expect(twice).toBe('a%2520b%252Fc')
    expect(detectDoubleEncoding(twice)).not.toBeNull()
  })

  it('counts escapes', () => {
    expect(countEscapes('a%20b%2fc%zz%')).toBe(2)
    expect(countEscapes('')).toBe(0)
  })
})

describe('locate', () => {
  it('is 1-based for line and column', () => {
    expect(locate('ab\ncd\nef', 0)).toEqual({ index: 0, line: 1, column: 1 })
    expect(locate('ab\ncd\nef', 4)).toEqual({ index: 4, line: 2, column: 2 })
    expect(locate('ab\ncd\nef', 6)).toEqual({ index: 6, line: 3, column: 1 })
  })
})
