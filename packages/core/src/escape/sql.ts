import { fail, ok, type EscapeResult } from './result.ts'

/**
 * `standard` is the SQL-92 rule every engine accepts: a quote is doubled and
 * nothing else is special. `mysql` is MySQL/MariaDB's default mode, where a
 * backslash is also an escape character (unless `NO_BACKSLASH_ESCAPES` is on).
 */
export type SqlDialect = 'standard' | 'mysql'

export interface SqlEscapeOptions {
  dialect?: SqlDialect
  /** Include the surrounding single quotes. Default true. */
  wrap?: boolean
}

// What mysql_real_escape_string escapes: enough that the literal survives a
// log line or a binary-unsafe client, not just the parser.
const MYSQL_OUT: Record<string, string> = {
  '\0': '\\0',
  '\n': '\\n',
  '\r': '\\r',
  '\x1a': '\\Z',
  "'": "\\'",
  '"': '\\"',
  '\\': '\\\\',
}

export function escapeSql(s: string, opts: SqlEscapeOptions = {}): string {
  let out: string
  if (opts.dialect === 'mysql') {
    out = ''
    let run = 0
    for (let i = 0; i < s.length; i++) {
      const rep = MYSQL_OUT[s[i]!]
      if (rep === undefined) continue
      out += s.slice(run, i) + rep
      run = i + 1
    }
    out += s.slice(run)
  } else {
    out = s.replaceAll("'", "''")
  }
  return opts.wrap === false ? out : `'${out}'`
}

/** Notes on input that escapes correctly but may still surprise. */
export function sqlWarnings(s: string, dialect: SqlDialect): string[] {
  const warnings: string[] = []
  if (dialect === 'standard' && s.includes('\\')) {
    warnings.push(
      'The text has a backslash. MySQL and MariaDB read it as an escape unless NO_BACKSLASH_ESCAPES is on; use the MySQL variant there.',
    )
  }
  if (s.includes('\0')) {
    warnings.push('The text has a NUL character (U+0000). PostgreSQL text columns reject it, and some drivers cut the string there.')
  }
  return warnings
}

const MYSQL_IN: Record<string, string> = {
  '0': '\0',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\x1a',
  // \% and \_ keep their backslash: they are LIKE-pattern escapes, and MySQL
  // deliberately leaves them for the pattern matcher.
  '%': '\\%',
  _: '\\_',
}

/**
 * Text that starts and ends with `'` is read as a whole literal and its outer
 * quotes are dropped; anything else is read as a literal's body. Either way a
 * lone `'` is an error, because it would end the string early.
 */
export function unescapeSql(input: string, dialect: SqlDialect = 'standard'): EscapeResult {
  let start = 0
  let stop = input.length
  while (/\s/.test(input[start] ?? '')) start++
  while (stop > start && /\s/.test(input[stop - 1]!)) stop--
  const quoted = stop - start >= 2 && input[start] === "'" && input[stop - 1] === "'"
  const from = quoted ? start + 1 : 0
  const to = quoted ? stop - 1 : input.length

  let out = ''
  let run = from
  for (let i = from; i < to; i++) {
    const c = input[i]
    if (c === "'") {
      if (input[i + 1] !== "'" || i + 1 >= to) {
        return fail(input, i, 'Unescaped quote', "a lone ' ends the string; double it as ''")
      }
      out += input.slice(run, i + 1)
      i++
      run = i + 1
    } else if (c === '\\' && dialect === 'mysql') {
      const e = input[i + 1]
      if (e === undefined || i + 1 >= to) {
        return quoted
          ? fail(input, i, 'Unterminated string', 'this backslash escapes the closing quote')
          : fail(input, i, 'Lone backslash at the end', 'write a literal backslash as \\\\')
      }
      out += input.slice(run, i) + (MYSQL_IN[e] ?? e)
      i++
      run = i + 1
    }
  }
  return ok(out + input.slice(run, to))
}
