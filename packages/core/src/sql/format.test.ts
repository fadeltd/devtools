import { describe, expect, it } from 'vitest'
import { formatSql, parseSqlError, SQL_DIALECTS, type SqlResult } from './format.ts'

function output(r: SqlResult): string {
  if (!r.ok) throw new Error(`expected success, got: ${r.error.message}`)
  return r.output
}

describe('formatSql', () => {
  it.each(SQL_DIALECTS.map((d) => d.value))('formats a smoke query in %s', async (dialect) => {
    const r = await formatSql('select a, b from t where a = 1 order by b', { dialect })
    expect(output(r)).toBe('select\n  a,\n  b\nfrom\n  t\nwhere\n  a = 1\norder by\n  b')
  })

  it('reads dialect-specific syntax', async () => {
    // `::` casts are PostgreSQL; the standard dialect cannot lex `$1`.
    expect(output(await formatSql('select $1::int', { dialect: 'postgresql' }))).toBe(
      'select\n  $1::int',
    )
    expect(output(await formatSql('select `a b` from t', { dialect: 'mysql' }))).toBe(
      'select\n  `a b`\nfrom\n  t',
    )
    expect(output(await formatSql('select [a b] from t', { dialect: 'transactsql' }))).toBe(
      'select\n  [a b]\nfrom\n  t',
    )
  })

  it('applies keyword case', async () => {
    const q = 'Select a From t'
    expect(output(await formatSql(q, { keywordCase: 'upper' }))).toBe('SELECT\n  a\nFROM\n  t')
    expect(output(await formatSql(q, { keywordCase: 'lower' }))).toBe('select\n  a\nfrom\n  t')
    expect(output(await formatSql(q, { keywordCase: 'preserve' }))).toBe('Select\n  a\nFrom\n  t')
  })

  it('honours indent', async () => {
    expect(output(await formatSql('select a from t', { indent: 4 }))).toBe(
      'select\n    a\nfrom\n    t',
    )
    expect(output(await formatSql('select a from t', { indent: 'tab' }))).toBe(
      'select\n\ta\nfrom\n\tt',
    )
  })

  it('honours lines between queries', async () => {
    expect(output(await formatSql('select 1; select 2', { linesBetweenQueries: 2 }))).toBe(
      'select\n  1;\n\n\nselect\n  2',
    )
    expect(output(await formatSql('select 1; select 2', { linesBetweenQueries: 0 }))).toBe(
      'select\n  1;\nselect\n  2',
    )
  })

  it('keeps comments', async () => {
    const out = output(
      await formatSql('-- top\nselect a /* inline */ from t -- tail\nwhere b = 1', {}),
    )
    expect(out).toContain('-- top')
    expect(out).toContain('/* inline */')
    expect(out).toContain('-- tail')
  })

  it('leaves string contents alone', async () => {
    expect(output(await formatSql("select 'a   b' from t"))).toContain("'a   b'")
  })

  it('returns empty output for blank input without loading anything', async () => {
    expect(await formatSql('  \n ')).toEqual({ ok: true, output: '' })
  })

  it('reports a parse error position from the parser', async () => {
    const r = await formatSql('select a\nfrom (select b from t', { dialect: 'postgresql' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.message).toBe('Unexpected end of input')
    expect(r.error.line).toBe(2)
    // One past the 21-character line: where the missing `)` should have been.
    expect(r.error.column).toBe(22)
  })

  it('reports a lexer error position, with the dialect hint for standard SQL', async () => {
    const r = await formatSql('select a\nfrom t where x = @@', { dialect: 'sql' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.message).toMatch(/^Unexpected "@@/)
    expect(r.error.line).toBe(2)
    expect(r.error.column).toBe(18)
    expect(r.error.hint).not.toBeNull()
  })
})

describe('parseSqlError', () => {
  it('keeps only the first sentence of the nearley dump', () => {
    const e = new Error(
      'Parse error at token: ) at line 3 column 7\nUnexpected CLOSE_PAREN token: {...}\n\nA rule…',
    )
    expect(parseSqlError(e)).toEqual({ message: 'Unexpected )', line: 3, column: 7, hint: null })
  })

  it('copes with a lexer excerpt that spans a newline', () => {
    const e = new Error('Parse error: Unexpected "@\nfrom" at line 1 column 9.\nSome hint')
    expect(parseSqlError(e)).toMatchObject({ message: 'Unexpected "@\nfrom"', line: 1, column: 9 })
  })

  it('has no position when the message gives none', () => {
    expect(parseSqlError(new Error('Parse error: Invalid SQL'))).toEqual({
      message: 'Invalid SQL',
      line: null,
      column: null,
      hint: null,
    })
    expect(parseSqlError('boom')).toMatchObject({ message: 'boom', line: null })
  })
})
