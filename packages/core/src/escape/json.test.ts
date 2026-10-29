import { describe, expect, it } from 'vitest'
import { escapeJson, unescapeJson } from './json.ts'

const errorAt = (input: string) => {
  const r = unescapeJson(input)
  if (r.ok) throw new Error(`expected an error for ${JSON.stringify(input)}`)
  return r.error
}

describe('escapeJson', () => {
  it('is JSON.stringify', () => {
    expect(escapeJson('say "hi"\n\t\\')).toBe('"say \\"hi\\"\\n\\t\\\\"')
    expect(escapeJson('\ud800')).toBe('"\\ud800"')
  })

  it('drops the quotes on request', () => {
    expect(escapeJson('a"b', { wrap: false })).toBe('a\\"b')
  })

  it('writes non-ASCII as \\u escapes, astral as a surrogate pair', () => {
    expect(escapeJson('é😀\x7f', { asciiOnly: true })).toBe('"\\u00e9\\ud83d\\ude00\\u007f"')
  })
})

describe('unescapeJson', () => {
  it('reads a quoted literal with surrounding whitespace', () => {
    expect(unescapeJson('  "a\\u00e9\\/b"\n')).toEqual({ ok: true, output: 'aé/b', warnings: [] })
  })

  it('reads a bare body and drops a trailing newline from the copy', () => {
    expect(unescapeJson('line\\nnext\n')).toMatchObject({ ok: true, output: 'line\nnext' })
    expect(unescapeJson('  keeps leading spaces')).toMatchObject({ ok: true, output: '  keeps leading spaces' })
  })

  it('keeps a lone surrogate escape, as JSON.parse does', () => {
    expect(unescapeJson('"\\ud800"')).toMatchObject({ ok: true, output: '\ud800' })
  })

  it('handles the empty string both ways', () => {
    expect(unescapeJson('')).toMatchObject({ ok: true, output: '' })
    expect(unescapeJson('""')).toMatchObject({ ok: true, output: '' })
  })

  describe('error positions', () => {
    it('invalid escape: at the backslash', () => {
      expect(errorAt('ab\\q')).toMatchObject({ index: 2, line: 1, column: 3 })
      expect(errorAt("\\'").message).toContain("don't escape single quotes")
    })

    it('incomplete \\u: at the backslash, with a hint for \\u{…}', () => {
      expect(errorAt('x\\u12')).toMatchObject({ index: 1 })
      expect(errorAt('x\\u12g4')).toMatchObject({ index: 1 })
      expect(errorAt('\\u{41}').message).toContain('JavaScript, not JSON')
    })

    it('lone backslash at the end', () => {
      expect(errorAt('abc\\')).toMatchObject({ index: 3 })
      expect(errorAt('abc\\\n')).toMatchObject({ index: 3 })
    })

    it('unescaped quote in a body', () => {
      expect(errorAt('say "hi"')).toMatchObject({ index: 4 })
    })

    it('raw control character, with line and column past the first line', () => {
      const e = errorAt('"a\nb"')
      expect(e).toMatchObject({ index: 2, line: 1, column: 3 })
      expect(e.message).toContain('\\n')
      expect(errorAt('ab\tc')).toMatchObject({ index: 2 })
    })

    it('text after the closing quote', () => {
      expect(errorAt('"a" x')).toMatchObject({ index: 4 })
    })

    it('unterminated string: at the opening quote', () => {
      expect(errorAt('  "abc')).toMatchObject({ index: 2 })
      expect(errorAt('"abc\\"')).toMatchObject({ index: 0 })
    })

    it('names the problem, the position and the fix', () => {
      const e = errorAt('ok\\nfine\\z')
      expect(e.message).toBe(
        'Invalid escape \\z at position 9: JSON allows only \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.',
      )
    })
  })
})
