import { describe, expect, it } from 'vitest'
import { escapeRegex, unescapeRegex } from './regex.ts'

describe('escapeRegex', () => {
  it('escapes every metacharacter and the literal delimiter', () => {
    expect(escapeRegex('a.b*c+d?e^f$g(h)i[j]k{l}m|n\\o/p')).toBe(
      'a\\.b\\*c\\+d\\?e\\^f\\$g\\(h\\)i\\[j\\]k\\{l\\}m\\|n\\\\o\\/p',
    )
  })

  it('leaves characters that are not syntax alone, which the u flag requires', () => {
    expect(escapeRegex('a-b,c=d:e')).toBe('a-b,c=d:e')
  })
})

describe('unescapeRegex', () => {
  it('reads a literal pattern back', () => {
    expect(unescapeRegex('1\\.5\\+\\(x\\)\\/\\-\\n\\x41\\u0042\\u{1F600}\\cJ\\0')).toMatchObject({
      ok: true,
      output: '1.5+(x)/-\nAB😀\n\0',
    })
  })

  describe('error positions', () => {
    it('an unescaped metacharacter', () => {
      expect(unescapeRegex('a.b')).toMatchObject({ ok: false, error: { index: 1 } })
      expect(unescapeRegex('ab|c')).toMatchObject({ ok: false, error: { index: 2 } })
    })

    it('a class or assertion escape', () => {
      expect(unescapeRegex('a\\d')).toMatchObject({ ok: false, error: { index: 1 } })
      expect(unescapeRegex('\\bword')).toMatchObject({ ok: false, error: { index: 0 } })
    })

    it('a backreference', () => {
      expect(unescapeRegex('(a)\\1'.slice(3))).toMatchObject({ ok: false, error: { index: 0 } })
      expect(unescapeRegex('x\\01')).toMatchObject({ ok: false, error: { index: 1 } })
    })

    it('malformed hex escapes', () => {
      expect(unescapeRegex('ab\\x4')).toMatchObject({ ok: false, error: { index: 2 } })
      expect(unescapeRegex('a\\u12')).toMatchObject({ ok: false, error: { index: 1 } })
      expect(unescapeRegex('a\\u{110000}')).toMatchObject({ ok: false, error: { index: 1 } })
    })

    it('an unknown letter escape', () => {
      expect(unescapeRegex('a\\q')).toMatchObject({ ok: false, error: { index: 1 } })
    })

    it('a lone backslash at the end', () => {
      expect(unescapeRegex('ab\\')).toMatchObject({ ok: false, error: { index: 2 } })
    })
  })
})
