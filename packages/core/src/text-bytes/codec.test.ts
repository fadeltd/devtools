import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeText, encodeText } from './codec.ts'
import { DEFAULT_FORMAT_OPTIONS, renderBytes, type ByteFormat, type FormatOptions } from './format.ts'

const opts = (o: Partial<FormatOptions>): FormatOptions => ({ ...DEFAULT_FORMAT_OPTIONS, ...o })
const enc = (text: string, o: Partial<FormatOptions>) => encodeText(text, opts(o)).output
const bytes = (...b: number[]) => new Uint8Array(b)

function decodeOk(input: string, format: Parameters<typeof decodeText>[1]): string {
  const r = decodeText(input, format)
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.reason === 'syntax' ? r.error.message : r.invalid.message}`)
  return r.text
}

describe('encodeText', () => {
  it('formats each byte in every base', () => {
    expect(enc('Hi', { format: 'binary' })).toBe('01001000 01101001')
    expect(enc('Hi', { format: 'hex' })).toBe('48 69')
    expect(enc('Hi', { format: 'decimal' })).toBe('72 105')
    expect(enc('Hi\n', { format: 'octal' })).toBe('110 151 012')
  })

  it('always encodes as UTF-8', () => {
    expect(enc('é', { format: 'hex' })).toBe('c3 a9')
    // 4-byte UTF-8, and one code point although two UTF-16 units.
    const party = encodeText('🎉', opts({ format: 'hex' }))
    expect(party.output).toBe('f0 9f 8e 89')
    expect(party.byteCount).toBe(4)
    expect(party.charCount).toBe(1)
  })

  it('keeps a BOM and \\r\\n as bytes', () => {
    expect(enc('\uFEFFa\r\n', { format: 'hex' })).toBe('ef bb bf 61 0d 0a')
  })

  it('applies hex case and prefix, leaving the prefix lowercase', () => {
    expect(enc('\u00ff', { format: 'hex', uppercase: true })).toBe('C3 BF')
    expect(enc('Hi', { format: 'hex', prefix: '0x', uppercase: true, separator: 'comma' })).toBe('0x48, 0x69')
    // The C / Python string-literal form.
    expect(enc('é!', { format: 'hex', prefix: '\\x', separator: 'none' })).toBe('\\xc3\\xa9\\x21')
  })

  it('ignores the hex prefix for other bases', () => {
    expect(enc('A', { format: 'decimal', prefix: '0x' })).toBe('65')
  })

  it('zero-pads decimal only when there is no separator, so it stays reversible', () => {
    expect(enc('\nA', { format: 'decimal' })).toBe('10 65')
    expect(enc('\nA', { format: 'decimal', separator: 'none' })).toBe('010065')
  })

  it('supports every separator', () => {
    expect(enc('ab', { format: 'hex', separator: 'none' })).toBe('6162')
    expect(enc('ab', { format: 'hex', separator: 'comma' })).toBe('61, 62')
    expect(enc('ab', { format: 'hex', separator: 'newline' })).toBe('61\n62')
  })

  it('wraps every N bytes, keeping commas at line ends', () => {
    const b = bytes(0, 1, 2, 3, 4)
    expect(renderBytes(b, opts({ format: 'hex', perLine: 2 }))).toBe('00 01\n02 03\n04')
    expect(renderBytes(b, opts({ format: 'hex', perLine: 2, separator: 'comma' }))).toBe('00, 01,\n02, 03,\n04')
    // Already one per line: grouping is moot.
    expect(renderBytes(b, opts({ format: 'hex', perLine: 2, separator: 'newline' }))).toBe('00\n01\n02\n03\n04')
  })

  it('counts lone surrogates, which TextEncoder turns into U+FFFD', () => {
    const r = encodeText('a\uD800b', opts({ format: 'hex' }))
    expect(r.output).toBe('61 ef bf bd 62')
    expect(r.loneSurrogates).toBe(1)
    expect(encodeText('🎉', opts({})).loneSurrogates).toBe(0)
  })

  it('handles empty input', () => {
    expect(encodeText('', opts({}))).toEqual({ output: '', byteCount: 0, charCount: 0, loneSurrogates: 0 })
  })

  it('stays linear on multi-MB input', () => {
    const text = 'é'.repeat(1_000_000) // 2 MB of UTF-8
    const started = performance.now()
    const out = encodeText(text, opts({ format: 'hex', perLine: 16 }))
    expect(out.byteCount).toBe(2_000_000)
    expect(decodeOk(out.output, 'hex')).toBe(text)
    expect(performance.now() - started).toBeLessThan(5000)
  })
})

describe('round-trip', () => {
  // Lone surrogates are not text TextEncoder can carry, so they are excluded:
  // their lossy encoding is covered above.
  const text = fc.string({ unit: 'grapheme' })
  const FORMATS: ByteFormat[] = ['binary', 'hex', 'decimal', 'octal']
  const layout = fc.record({
    separator: fc.constantFrom('space', 'none', 'comma', 'newline' as const),
    uppercase: fc.boolean(),
    prefix: fc.constantFrom('none', '0x', '\\x' as const),
    perLine: fc.constantFrom(0, 1, 8, 16),
  })

  for (const format of FORMATS) {
    it(`text → ${format} → text is lossless for any options`, () => {
      fc.assert(
        fc.property(text, layout, (s, l) => {
          const out = encodeText(s, { format, ...l }).output
          expect(decodeOk(out, format)).toBe(s)
        }),
      )
    })
  }

  it('auto-detect reads binary output back as binary', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', minLength: 1 }), layout, (s, l) => {
        const out = encodeText(s, { format: 'binary', ...l }).output
        const r = decodeText(out, 'auto')
        expect(r.ok && r.text).toBe(s)
        expect(r.format).toBe('binary')
      }),
    )
  })

  it('auto-detect reads prefixed hex output back as hex', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', minLength: 1 }), layout, fc.constantFrom('0x', '\\x' as const), (s, l, prefix) => {
        const r = decodeText(encodeText(s, { ...l, format: 'hex', prefix }).output, 'auto')
        expect(r.ok && r.text).toBe(s)
        expect(r.detection?.reason).toBe('prefix')
      }),
    )
  })

  it('round-trips emoji, a BOM and \\r\\n exactly', () => {
    for (const s of ['👨‍👩‍👧‍👦', '🇯🇵', '\uFEFFbom first', 'line\r\nline\r\n', 'café', '\0nul']) {
      for (const format of FORMATS) expect(decodeOk(enc(s, { format }), format)).toBe(s)
    }
  })
})

describe('decodeText', () => {
  it('keeps a leading BOM instead of stripping it, and says so', () => {
    const r = decodeText('ef bb bf 68 69', 'hex')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toBe('\uFEFFhi')
    expect(r.bom).toBe(true)
    expect(r.charCount).toBe(3)
  })

  it('reports the parse error instead of throwing', () => {
    const r = decodeText('48 6g', 'hex')
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'syntax') return
    expect(r.error.kind).toBe('invalid-digit')
    expect(r.error.index).toBe(4)
  })

  it('reports invalid UTF-8 with a labelled fallback', () => {
    const r = decodeText('c3 28', 'hex')
    expect(r.ok).toBe(false)
    if (r.ok || r.reason !== 'not-utf8') return
    expect(r.invalid.offset).toBe(0)
    expect(r.invalid.problem).toBe('bad-continuation')
    expect(r.replacement).toBe('\uFFFD(')
    expect(r.latin1).toBe('Ã(')
  })

  it('reports truncated and lone-continuation input', () => {
    const lone = decodeText('41 80 42', 'hex')
    expect(!lone.ok && lone.reason === 'not-utf8' && lone.invalid).toMatchObject({ offset: 1, problem: 'unexpected-continuation' })

    const cut = decodeText('41 f0 9f 8e', 'hex')
    expect(!cut.ok && cut.reason === 'not-utf8' && cut.invalid).toMatchObject({ offset: 1, length: 3, problem: 'truncated' })
    expect(!cut.ok && cut.reason === 'not-utf8' && cut.replacement).toBe('A\uFFFD')
  })

  it('returns empty text for empty input, with nothing detected', () => {
    for (const input of ['', '   \n', ', ,']) {
      const r = decodeText(input, 'auto')
      expect(r).toMatchObject({ ok: true, text: '', format: null, detection: null })
    }
    expect(decodeText('', 'hex')).toMatchObject({ ok: true, text: '', format: 'hex' })
  })

  it('reports what auto-detect chose', () => {
    expect(decodeText('72 101 108 108 111', 'auto')).toMatchObject({
      ok: true,
      text: 'Hello',
      format: 'decimal',
      detection: { reason: 'only-valid', alsoValid: [] },
    })
  })
})
