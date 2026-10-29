import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { minifySql } from './minify.ts'

describe('minifySql', () => {
  it('collapses whitespace and tightens punctuation', () => {
    expect(minifySql('SELECT\n  a ,\n  count( * )\nFROM\n  t\nWHERE  x = 1 ;\n')).toBe(
      'SELECT a,count(*)FROM t WHERE x = 1;',
    )
  })

  it('leaves whitespace inside string literals untouched', () => {
    expect(minifySql("select   'a  b'  ,  'it''s  here'\nfrom t")).toBe(
      "select 'a  b','it''s  here' from t",
    )
  })

  it('leaves quoted identifiers untouched', () => {
    expect(minifySql('select  "a   b"  from  t')).toBe('select "a   b" from t')
    expect(minifySql('select  `a   b`  from  t', { dialect: 'mysql' })).toBe('select `a   b` from t')
    expect(minifySql('select  [a   b]  from  t', { dialect: 'transactsql' })).toBe(
      'select [a   b] from t',
    )
  })

  it('reads backslash escapes only where the dialect has them', () => {
    // MySQL: \' does not end the string.
    expect(minifySql("select 'a\\'  b'   from t", { dialect: 'mysql' })).toBe(
      "select 'a\\'  b' from t",
    )
    // PostgreSQL: 'C:\' is a whole string, and what follows is code.
    expect(minifySql("select 'C:\\'   ,   'x  y'", { dialect: 'postgresql' })).toBe(
      "select 'C:\\','x  y'",
    )
    // ...except in an E'' string.
    expect(minifySql("select E'a\\'  b'   from t", { dialect: 'postgresql' })).toBe(
      "select E'a\\'  b' from t",
    )
  })

  it('leaves dollar-quoted bodies untouched, but not $1 parameters', () => {
    const fn = 'create function f() returns int as $body$\n  select   1;\n$body$   language sql'
    expect(minifySql(fn, { dialect: 'postgresql' })).toBe(
      'create function f()returns int as $body$\n  select   1;\n$body$ language sql',
    )
    expect(minifySql('select  $1  ,  $2', { dialect: 'postgresql' })).toBe('select $1,$2')
  })

  it('keeps comments verbatim, and a line comment keeps its newline', () => {
    expect(minifySql('select a -- the  a\nfrom t /* keep   me */ where b')).toBe(
      'select a -- the  a\nfrom t /* keep   me */ where b',
    )
  })

  it('strips comments on request, but never hints or versioned comments', () => {
    expect(
      minifySql('select /*+ INDEX(t i) */ a -- x\nfrom t /* gone */ where /*!50000 b */ = 1', {
        stripComments: true,
        dialect: 'mysql',
      }),
    ).toBe('select /*+ INDEX(t i) */ a from t where /*!50000 b */ = 1')
  })

  it('leaves a space where a glued comment was', () => {
    expect(minifySql('select a/*x*/from t', { stripComments: true })).toBe('select a from t')
  })

  it('treats # as a comment only in MySQL-likes', () => {
    expect(minifySql('select a # c\nfrom t', { dialect: 'mysql', stripComments: true })).toBe(
      'select a from t',
    )
    expect(minifySql('select a # c\nfrom t', { dialect: 'postgresql' })).toBe(
      'select a # c from t',
    )
  })

  it('never joins tokens into a comment', () => {
    expect(minifySql('select a - -1, b / *c')).toBe('select a - -1,b / *c')
  })

  it('handles BigQuery triple-quoted strings', () => {
    expect(minifySql("select   '''it's  here'''   x", { dialect: 'bigquery' })).toBe(
      "select '''it's  here''' x",
    )
  })

  it('keeps an unterminated string verbatim', () => {
    expect(minifySql("select   'a  b")).toBe("select 'a  b")
  })

  it('is empty for blank input', () => {
    expect(minifySql('  \n\t ')).toBe('')
  })

  // Idempotence catches the subtle failures: a space dropped or added on the
  // first pass that changes how the second pass tokenizes the result.
  it.each(['sql', 'postgresql', 'mysql', 'bigquery', 'transactsql'] as const)(
    'is idempotent in %s, even on garbage',
    (dialect) => {
      const pieces = fc.constantFrom(...'aE1 \n();,-*/#\\[]\'"`$', '--', '/*', '*/', '$$', '$t$')
      const sql = fc.array(pieces, { maxLength: 40 }).map((a) => a.join(''))
      const min = (s: string) => minifySql(s, { dialect })
      fc.assert(
        fc.property(sql, (s) => min(min(s)) === min(s)),
        { numRuns: 3000 },
      )
    },
  )
})
