import { describe, expect, it } from 'vitest'
import { detectAndParse, parseBytes, type ParseErrorKind } from './parse.ts'
import type { ByteFormat } from './format.ts'

function ok(input: string, format: ByteFormat): number[] {
  const r = parseBytes(input, format)
  if (!r.ok) throw new Error(r.error.message)
  return [...r.bytes]
}

function err(input: string, format: ByteFormat) {
  const r = parseBytes(input, format)
  if (r.ok) throw new Error(`expected an error for ${JSON.stringify(input)}`)
  return r.error
}

describe('parseBytes: tolerant of layout', () => {
  it('accepts any whitespace, commas and literal punctuation as separators', () => {
    const want = [0x48, 0x65, 0x6c]
    for (const input of ['48 65 6c', '48,65,6c', '48, 65,\n6c', '48\t65\r\n6c', '[48, 65, 6c]', '{48;65;6c}', '48:65:6c', '"48 65 6c"', '\u00a048 65 6c ']) {
      expect(ok(input, 'hex')).toEqual(want)
    }
  })

  it('splits contiguous hex and binary into bytes', () => {
    expect(ok('48656C', 'hex')).toEqual([0x48, 0x65, 0x6c])
    expect(ok('0100100001101001', 'binary')).toEqual([0x48, 0x69])
  })

  it('accepts mixed 0x and \\x prefixes, separated or back to back', () => {
    expect(ok('0x48 \\x65 6c 0X6C \\X6f', 'hex')).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f])
    expect(ok('\\x48\\x65\\x6c', 'hex')).toEqual([0x48, 0x65, 0x6c])
    expect(ok('{0x48, 0x65}', 'hex')).toEqual([0x48, 0x65])
    // Our own 0x output with no separator must read back.
    expect(ok('0x480x65', 'hex')).toEqual([0x48, 0x65])
    expect(ok('0b1010b1', 'binary')).toEqual([0b101, 1])
  })

  it('treats a prefixed short group as a number literal', () => {
    // \x9 and 0x9 are valid C; a bare "9" is a stray nibble.
    expect(ok('\\x9 0xa', 'hex')).toEqual([9, 10])
    expect(ok('0b101 0B11111111', 'binary')).toEqual([5, 255])
    expect(ok('\\101\\7 0o12', 'octal')).toEqual([0o101, 7, 0o12])
  })

  it('reads a prefixed long group as back-to-back bytes', () => {
    expect(ok('0x4865', 'hex')).toEqual([0x48, 0x65])
  })

  it('splits back-to-back decimal and octal only in zero-padded triples', () => {
    expect(ok('072101', 'decimal')).toEqual([72, 101])
    expect(ok('110151', 'octal')).toEqual([0o110, 0o151])
    expect(ok('7 07 007', 'decimal')).toEqual([7, 7, 7])
  })

  it('is empty for blank input', () => {
    expect(ok('', 'hex')).toEqual([])
    expect(ok(' ,\n ', 'binary')).toEqual([])
  })
})

describe('parseBytes: strict about content, with positions', () => {
  const cases: [string, ByteFormat, ParseErrorKind, string, number][] = [
    ['48 656', 'hex', 'odd-hex', '656', 3],
    ['48656c6', 'hex', 'odd-hex', '48656c6', 0],
    ['48 6', 'hex', 'odd-hex', '6', 3],
    ['01001000 1101001', 'binary', 'binary-length', '1101001', 9],
    ['72 256 1', 'decimal', 'out-of-range', '256', 3],
    ['72101', 'decimal', 'out-of-range', '72101', 0],
    ['072300', 'decimal', 'out-of-range', '300', 3],
    ['101 400', 'octal', 'out-of-range', '400', 4],
    ['48 6g', 'hex', 'invalid-digit', 'g', 4],
    ['01000001 01200000', 'binary', 'invalid-digit', '2', 11],
    ['12 ab', 'decimal', 'invalid-digit', 'a', 3],
    ['17 18', 'octal', 'invalid-digit', '8', 4],
    ['48 -5', 'hex', 'invalid-digit', '-', 3],
    ['48 0x', 'hex', 'dangling-prefix', '0x', 3],
    ['\\x48\\x', 'hex', 'dangling-prefix', '\\x', 4],
  ]

  for (const [input, format, kind, token, index] of cases) {
    it(`${format} ${JSON.stringify(input)} → ${kind} “${token}” at ${index}`, () => {
      expect(err(input, format)).toMatchObject({ kind, token, index })
    })
  }

  it('reports line and column, 1-based', () => {
    const e = err('48 65\n6c zz', 'hex')
    expect(e).toMatchObject({ index: 9, line: 2, column: 4 })
    expect(e.message).toContain('position 10, line 2, column 4')
  })

  it('reports an emoji as a whole character, not half a surrogate pair', () => {
    expect(err('48 🎉', 'hex')).toMatchObject({ kind: 'invalid-digit', token: '🎉', index: 3 })
  })

  it('clips a huge token in the error', () => {
    const e = err('1'.repeat(100_001), 'binary')
    expect(e.kind).toBe('binary-length')
    expect(e.token.length).toBeLessThan(40)
    expect(e.message).toContain('100001 bits')
  })

  it('reports the first error in input order', () => {
    expect(err('4 zz', 'hex').kind).toBe('odd-hex')
  })
})

function detect(input: string) {
  const { detection, result } = detectAndParse(input)
  return { ...detection, bytes: result.ok ? [...result.bytes] : null }
}

describe('detectAndParse', () => {

  it('picks the only format that parses', () => {
    expect(detect('48 65 6c 6c 6f')).toMatchObject({ format: 'hex', reason: 'only-valid' })
    expect(detect('72 101 108')).toMatchObject({ format: 'decimal', reason: 'only-valid' })
  })

  it('is certain about hex when it sees 0x or \\x', () => {
    expect(detect('0x10 0x20')).toMatchObject({ format: 'hex', reason: 'prefix', bytes: [16, 32] })
    expect(detect('\\x31\\x32')).toMatchObject({ format: 'hex', reason: 'prefix', bytes: [0x31, 0x32] })
  })

  it('prefers binary for 8-bit groups of 0 and 1, though they are also valid hex', () => {
    expect(detect('01001000 01101001')).toMatchObject({ format: 'binary', reason: 'cleanest', alsoValid: ['hex'], bytes: [0x48, 0x69] })
  })

  // `10` is hex 0x10, decimal 10, and only binary-ish (2 bits is not a byte).
  it('resolves `10` to decimal: a newline is more text-like than the DLE control code', () => {
    expect(detect('10')).toMatchObject({ format: 'decimal', reason: 'cleanest', alsoValid: ['hex'], bytes: [10] })
  })

  it('prefers the reading that is valid UTF-8', () => {
    // As hex these are lone continuation bytes; as decimal, "cba".
    expect(detect('99 98 97')).toMatchObject({ format: 'decimal', reason: 'cleanest', alsoValid: ['hex'] })
  })

  it('breaks a true tie by precedence, hex before decimal, and flags the doubt', () => {
    // Hex "ABC" or decimal ")*+": both clean text.
    expect(detect('41 42 43')).toMatchObject({ format: 'hex', reason: 'precedence', alsoValid: ['decimal'], bytes: [0x41, 0x42, 0x43] })
  })

  it('reports the error of the format that got furthest when nothing parses', () => {
    const { detection, result } = detectAndParse('48 65 6c 6g')
    expect(detection).toMatchObject({ format: 'hex', reason: 'none-valid' })
    expect(!result.ok && result.error).toMatchObject({ kind: 'invalid-digit', token: 'g', index: 10 })
  })
})
