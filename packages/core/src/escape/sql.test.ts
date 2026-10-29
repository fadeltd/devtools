import { describe, expect, it } from 'vitest'
import { escapeSql, sqlWarnings, unescapeSql } from './sql.ts'

describe('escapeSql', () => {
  it('doubles quotes in standard SQL, and nothing else', () => {
    expect(escapeSql("O'Brien \\ \"x\"")).toBe("'O''Brien \\ \"x\"'")
    expect(escapeSql("it's", { wrap: false })).toBe("it''s")
  })

  it('uses backslash escapes for MySQL', () => {
    expect(escapeSql("a'b\"c\\d\0e\nf\rg\x1ah", { dialect: 'mysql' })).toBe(
      "'a\\'b\\\"c\\\\d\\0e\\nf\\rg\\Zh'",
    )
  })

  it('warns about backslashes in standard mode and about NUL', () => {
    expect(sqlWarnings('a\\b', 'standard')[0]).toContain('MySQL')
    expect(sqlWarnings('a\\b', 'mysql')).toEqual([])
    expect(sqlWarnings('a\0', 'mysql')[0]).toContain('NUL')
  })
})

describe('unescapeSql', () => {
  it('reads a whole literal or a body', () => {
    expect(unescapeSql(" 'it''s' ")).toMatchObject({ ok: true, output: "it's" })
    expect(unescapeSql("it''s")).toMatchObject({ ok: true, output: "it's" })
    expect(unescapeSql("''")).toMatchObject({ ok: true, output: '' })
  })

  it('leaves backslashes alone in standard SQL', () => {
    expect(unescapeSql("'a\\nb'")).toMatchObject({ ok: true, output: 'a\\nb' })
  })

  it('decodes MySQL escapes, keeping \\% and \\_ for LIKE', () => {
    expect(unescapeSql("'\\0\\'\\\"\\b\\n\\r\\t\\Z\\\\\\%\\_\\q'''", 'mysql')).toMatchObject({
      ok: true,
      output: "\0'\"\b\n\r\t\x1a\\\\%\\_q'",
    })
  })

  describe('error positions', () => {
    it('a lone quote', () => {
      const r = unescapeSql("'it's'")
      expect(r).toMatchObject({ ok: false, error: { index: 3 } })
      expect(unescapeSql("it's")).toMatchObject({ ok: false, error: { index: 2 } })
    })

    it('a quote doubled at the very end is still a lone closing quote short', () => {
      expect(unescapeSql("'a''")).toMatchObject({ ok: false, error: { index: 2 } })
    })

    it('a MySQL backslash that escapes the closing quote', () => {
      expect(unescapeSql("'abc\\'", 'mysql')).toMatchObject({ ok: false, error: { index: 4 } })
      expect(unescapeSql('abc\\', 'mysql')).toMatchObject({ ok: false, error: { index: 3 } })
    })
  })
})
