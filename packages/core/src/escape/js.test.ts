import { describe, expect, it } from 'vitest'
import { escapeJs, unescapeJs } from './js.ts'

const errorAt = (input: string) => {
  const r = unescapeJs(input)
  if (r.ok) throw new Error(`expected an error for ${JSON.stringify(input)}`)
  return r.error
}

describe('escapeJs', () => {
  it('escapes only the chosen quote', () => {
    expect(escapeJs(`it's "x"`, { quote: "'" })).toBe(`'it\\'s "x"'`)
    expect(escapeJs(`it's "x"`, { quote: '"' })).toBe(`"it's \\"x\\""`)
    expect(escapeJs('a`b', { quote: '`', wrap: false })).toBe('a\\`b')
  })

  it('escapes ${ in a template, but not a lone $', () => {
    expect(escapeJs('${x} $y {z}', { quote: '`' })).toBe('`\\${x} $y {z}`')
    expect(escapeJs('${x}', { quote: '"' })).toBe('"${x}"')
  })

  it('escapes line separators, lone surrogates and controls', () => {
    expect(escapeJs('\u2028\u2029', { wrap: false })).toBe('\\u2028\\u2029')
    expect(escapeJs('\ud800x\udfff', { wrap: false })).toBe('\\uD800x\\uDFFF')
    expect(escapeJs('\x01\x7f\x9f\v', { wrap: false })).toBe('\\x01\\x7F\\x9F\\v')
  })

  it('writes NUL as \\x00 before a digit, where \\0 would read as octal', () => {
    expect(escapeJs('\x001\x00a', { wrap: false })).toBe('\\x001\\0a')
  })

  it('keeps emoji raw by default and uses \\u{…} in ASCII mode', () => {
    expect(escapeJs('é😀', { wrap: false })).toBe('é😀')
    expect(escapeJs('é€😀', { wrap: false, asciiOnly: true })).toBe('\\xE9\\u20AC\\u{1F600}')
  })
})

describe('unescapeJs', () => {
  it('reads whole literals of each quote style', () => {
    expect(unescapeJs(`'it\\'s'`)).toMatchObject({ ok: true, output: "it's" })
    expect(unescapeJs(` "a\\tb" `)).toMatchObject({ ok: true, output: 'a\tb' })
    expect(unescapeJs('`a\\${b}`')).toMatchObject({ ok: true, output: 'a${b}' })
  })

  it('reads a body with quotes and line breaks as they are', () => {
    expect(unescapeJs(`say "hi"\nit's`)).toMatchObject({ ok: true, output: `say "hi"\nit's` })
  })

  it('decodes every escape form', () => {
    expect(unescapeJs('\\x41\\u0042\\u{43}\\u{1F600}\\0\\b\\f\\n\\r\\t\\v\\q')).toMatchObject({
      ok: true,
      output: 'ABC😀\0\b\f\n\r\t\vq',
    })
  })

  it('drops line continuations', () => {
    expect(unescapeJs('"a\\\nb\\\r\nc\\\u2028d"')).toMatchObject({ ok: true, output: 'abcd' })
  })

  it('normalises raw CRLF in a template, as the engine does', () => {
    expect(unescapeJs('`a\r\nb\rc`')).toMatchObject({ ok: true, output: 'a\nb\nc' })
  })

  describe('error positions', () => {
    it('legacy octal and \\8, \\9', () => {
      expect(errorAt('ab\\1')).toMatchObject({ index: 2 })
      expect(errorAt('\\01')).toMatchObject({ index: 0 })
      expect(errorAt('x\\8')).toMatchObject({ index: 1 })
    })

    it('incomplete \\x', () => {
      expect(errorAt('ab\\x4')).toMatchObject({ index: 2 })
      expect(errorAt('"\\x4"')).toMatchObject({ index: 1 })
    })

    it('incomplete \\u and malformed \\u{…}', () => {
      expect(errorAt('a\\u12')).toMatchObject({ index: 1 })
      expect(errorAt('a\\u{}')).toMatchObject({ index: 1 })
      expect(errorAt('a\\u{12')).toMatchObject({ index: 1 })
      expect(errorAt('a\\u{xyz}')).toMatchObject({ index: 1 })
      expect(errorAt('a\\u{110000}')).toMatchObject({ index: 1 })
    })

    it('unescaped quote inside a literal', () => {
      expect(errorAt(`'it's'`)).toMatchObject({ index: 3 })
    })

    it('raw line break in a quoted literal, with line and column', () => {
      expect(errorAt('"a\nb"')).toMatchObject({ index: 2, line: 1, column: 3 })
    })

    it('template substitution', () => {
      expect(errorAt('`a${b}`')).toMatchObject({ index: 2 })
    })

    it('a backslash that escapes the closing quote', () => {
      expect(errorAt('"abc\\"')).toMatchObject({ index: 4 })
      expect(errorAt('abc\\').message).toContain('Lone backslash')
    })

    it('reports line and column on later lines', () => {
      const e = errorAt('first\nsecond \\x')
      expect(e).toMatchObject({ index: 13, line: 2, column: 8 })
      expect(e.message).toContain('position 14 (line 2, column 8)')
    })
  })
})
