/** The dialects offered, in the order a picker should list them. */
export const SQL_DIALECTS = [
  { value: 'sql', label: 'Standard SQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'bigquery', label: 'BigQuery' },
  { value: 'snowflake', label: 'Snowflake' },
  { value: 'transactsql', label: 'SQL Server (T-SQL)' },
  { value: 'plsql', label: 'Oracle PL/SQL' },
  { value: 'redshift', label: 'Redshift' },
  { value: 'spark', label: 'Spark SQL' },
  { value: 'trino', label: 'Trino / Presto' },
] as const

export type SqlDialect = (typeof SQL_DIALECTS)[number]['value']
export type SqlKeywordCase = 'preserve' | 'upper' | 'lower'
export type SqlIndent = 2 | 4 | 'tab'

export interface SqlFormatOptions {
  dialect: SqlDialect
  keywordCase: SqlKeywordCase
  indent: SqlIndent
  /** Blank lines between statements. */
  linesBetweenQueries: number
}

export const DEFAULT_SQL_FORMAT: SqlFormatOptions = {
  dialect: 'sql',
  keywordCase: 'preserve',
  indent: 2,
  linesBetweenQueries: 1,
}

export interface SqlError {
  message: string
  /** 1-based, when the library reported a position. */
  line: number | null
  /** 1-based, when the library reported a position. */
  column: number | null
  /** Advice the library attached, such as picking a more specific dialect. */
  hint: string | null
}

export type SqlResult = { ok: true; output: string } | { ok: false; error: SqlError }

const POSITION = / at line (\d+) column (\d+)\.?/

/**
 * sql-formatter throws plain `Error`s whose only structure is the message:
 * the lexer says `Parse error: Unexpected "…" at line L column C.` plus a
 * dialect hint, and the nearley parser says `Parse error at token: X at line L
 * column C` followed by a dump of every grammar rule it could have expected,
 * which runs to hundreds of lines. Keep the first sentence and the position.
 */
export function parseSqlError(e: unknown): SqlError {
  const raw = e instanceof Error ? e.message : String(e)
  const pos = POSITION.exec(raw)
  const line = pos ? Number(pos[1]) : null
  const column = pos ? Number(pos[2]) : null

  // The lexer quotes the next ten characters, which may span a newline, so the
  // head is everything up to the position rather than the first line.
  const head = (pos ? raw.slice(0, pos.index) : (raw.split('\n')[0] ?? raw)).trim()

  let message: string
  const token = /^Parse error at token: (.*)$/s.exec(head)
  if (token) {
    const text = token[1]!
    message = text === '«EOF»' ? 'Unexpected end of input' : `Unexpected ${text}`
  } else {
    // Also covers "Ambiguous grammar", whose JSON dump starts on line two.
    message = head.replace(/^Parse error:\s*/, '') || 'Could not parse this SQL'
  }

  const hint = /please select a more specific dialect/.test(raw)
    ? 'The standard SQL dialect does not know this syntax. Pick the database it was written for.'
    : null

  return { message, line, column, hint }
}

/**
 * Format with sql-formatter. The library (~80 kB gzip with every dialect) is
 * imported here rather than at the top of the module, so nothing that merely
 * imports this subpath pays for it until a query is actually formatted.
 *
 * Comments survive: sql-formatter keeps them as tokens.
 */
export async function formatSql(
  input: string,
  opts: Partial<SqlFormatOptions> = {},
): Promise<SqlResult> {
  const o = { ...DEFAULT_SQL_FORMAT, ...opts }
  if (input.trim() === '') return { ok: true, output: '' }

  try {
    const { format } = await import('sql-formatter')
    const output = format(input, {
      language: o.dialect,
      keywordCase: o.keywordCase,
      tabWidth: o.indent === 'tab' ? 2 : o.indent,
      useTabs: o.indent === 'tab',
      linesBetweenQueries: Math.max(0, Math.floor(o.linesBetweenQueries)),
    })
    return { ok: true, output }
  } catch (e) {
    return { ok: false, error: parseSqlError(e) }
  }
}
