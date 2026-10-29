import { describe, expect, it } from 'vitest'
import { escapeShell, shellWarnings, unescapeShell } from './shell.ts'

describe('escapeShell', () => {
  it('wraps in single quotes with the quote-escape idiom', () => {
    expect(escapeShell("it's")).toBe("'it'\\''s'")
    expect(escapeShell('$HOME `id` "x" \\n *')).toBe('\'$HOME `id` "x" \\n *\'')
  })

  it('keeps an empty string as an argument', () => {
    expect(escapeShell('')).toBe("''")
  })

  it('warns that NUL cannot be passed', () => {
    expect(shellWarnings('a\0b')).toHaveLength(1)
    expect(shellWarnings('ab')).toEqual([])
  })
})

describe('unescapeShell', () => {
  it('resolves single quotes, double quotes and backslashes', () => {
    expect(unescapeShell("'it'\\''s'")).toMatchObject({ ok: true, output: "it's" })
    expect(unescapeShell('"a \\"b\\" \\$c \\\\ \\n $"')).toMatchObject({ ok: true, output: 'a "b" $c \\ \\n $' })
    expect(unescapeShell('a\\ b\\\nc')).toMatchObject({ ok: true, output: 'a bc' })
    expect(unescapeShell("  'padded'  ")).toMatchObject({ ok: true, output: 'padded' })
  })

  it('warns once about an unquoted glob', () => {
    const r = unescapeShell('*.txt?')
    expect(r).toMatchObject({ ok: true, output: '*.txt?' })
    if (r.ok) expect(r.warnings).toHaveLength(1)
  })

  describe('error positions', () => {
    it('unterminated quotes: at the opening quote', () => {
      expect(unescapeShell("ab'cd")).toMatchObject({ ok: false, error: { index: 2 } })
      expect(unescapeShell('ab"cd')).toMatchObject({ ok: false, error: { index: 2 } })
    })

    it('unquoted whitespace splits arguments', () => {
      expect(unescapeShell('a b')).toMatchObject({ ok: false, error: { index: 1 } })
    })

    it('expansions, inside and outside double quotes', () => {
      expect(unescapeShell('a$HOME')).toMatchObject({ ok: false, error: { index: 1 } })
      expect(unescapeShell('"x$(id)"')).toMatchObject({ ok: false, error: { index: 2 } })
      expect(unescapeShell('"x`id`"')).toMatchObject({ ok: false, error: { index: 2 } })
      expect(unescapeShell('ab`id`')).toMatchObject({ ok: false, error: { index: 2 } })
    })

    it("Bash's $'…'", () => {
      expect(unescapeShell("x$'\\n'")).toMatchObject({ ok: false, error: { index: 1 } })
    })

    it('operators, comments and tildes', () => {
      expect(unescapeShell('a;b')).toMatchObject({ ok: false, error: { index: 1 } })
      expect(unescapeShell('a|b')).toMatchObject({ ok: false, error: { index: 1 } })
      expect(unescapeShell('#x')).toMatchObject({ ok: false, error: { index: 0 } })
      expect(unescapeShell('~/x')).toMatchObject({ ok: false, error: { index: 0 } })
      expect(unescapeShell('a#b~')).toMatchObject({ ok: true, output: 'a#b~' })
    })

    it('a lone backslash at the end', () => {
      expect(unescapeShell('ab\\')).toMatchObject({ ok: false, error: { index: 2 } })
    })
  })
})
