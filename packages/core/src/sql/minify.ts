import type { SqlDialect } from './format.ts'

export interface SqlMinifyOptions {
  dialect: SqlDialect
  /**
   * Drop `--`, `#` and block comments. Optimizer hints (`/*+ … *\/`) and
   * MySQL's versioned comments (`/*! … *\/`) are kept even then: the database
   * reads them, so removing one changes the plan or the query itself.
   */
  stripComments: boolean
}

// Each of these quirks is per-dialect: applying one everywhere would misread
// valid SQL elsewhere -- `'C:\'` is a complete string in PostgreSQL, and `#`
// starts a comment only in MySQL-likes.
const BACKSLASH_ESCAPES: ReadonlySet<SqlDialect> = new Set([
  'mysql',
  'mariadb',
  'bigquery',
  'snowflake',
  'spark',
])
const HASH_COMMENTS: ReadonlySet<SqlDialect> = new Set(['mysql', 'mariadb', 'bigquery'])
const DOLLAR_QUOTES: ReadonlySet<SqlDialect> = new Set(['postgresql', 'redshift', 'snowflake'])
const NESTED_BLOCK_COMMENTS: ReadonlySet<SqlDialect> = new Set(['postgresql'])
const TRIPLE_QUOTES: ReadonlySet<SqlDialect> = new Set(['bigquery'])
const BRACKET_IDENTIFIERS: ReadonlySet<SqlDialect> = new Set(['transactsql'])

// A space next to one of these is never needed to keep two tokens apart.
// `-`, `/` and `*` are deliberately absent: joining `-` `-` or `/` `*` would
// start a comment.
const TIGHT = new Set(['(', ')', ',', ';'])

type Token =
  | { kind: 'space' }
  /** Ordinary SQL: keywords, identifiers, operators, punctuation. */
  | { kind: 'code'; text: string }
  /** A string, quoted identifier or dollar-quoted body, kept byte-for-byte. */
  | { kind: 'quoted'; text: string }
  | { kind: 'block'; text: string }
  /** Without its newline. */
  | { kind: 'line'; text: string }

/** Index just past a quoted run whose `close.length`-long opener is at `start`. */
function scanQuoted(s: string, start: number, close: string, backslash: boolean): number {
  let i = start + close.length
  while (i < s.length) {
    if (backslash && s[i] === '\\') {
      i += 2
      continue
    }
    if (s.startsWith(close, i)) {
      // A doubled closer is an escaped one: 'it''s', "a""b", `a``b`, [a]]b].
      if (close.length === 1 && s[i + 1] === close) {
        i += 2
        continue
      }
      return i + close.length
    }
    i++
  }
  // Unterminated: keep the rest verbatim rather than guess.
  return s.length
}

function scanBlockComment(s: string, start: number, nested: boolean): number {
  let depth = 1
  let i = start + 2
  while (i < s.length) {
    if (s.startsWith('*/', i)) {
      depth--
      i += 2
      if (depth === 0) return i
    } else if (nested && s.startsWith('/*', i)) {
      depth++
      i += 2
    } else {
      i++
    }
  }
  return s.length
}

const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y
const SPACE = /\s/

function tokenize(s: string, d: SqlDialect): Token[] {
  const out: Token[] = []
  let code = ''
  const flush = () => {
    if (code !== '') out.push({ kind: 'code', text: code })
    code = ''
  }
  const push = (t: Token) => {
    flush()
    out.push(t)
  }
  const backslash = BACKSLASH_ESCAPES.has(d)

  let i = 0
  while (i < s.length) {
    const ch = s[i]!

    if (SPACE.test(ch)) {
      while (i < s.length && SPACE.test(s[i]!)) i++
      push({ kind: 'space' })
      continue
    }

    if (s.startsWith('--', i) || (ch === '#' && HASH_COMMENTS.has(d))) {
      let end = s.indexOf('\n', i)
      if (end === -1) end = s.length
      push({ kind: 'line', text: s.slice(i, end).replace(/\r$/, '') })
      i = end
      continue
    }

    if (s.startsWith('/*', i)) {
      const end = scanBlockComment(s, i, NESTED_BLOCK_COMMENTS.has(d))
      push({ kind: 'block', text: s.slice(i, end) })
      i = end
      continue
    }

    let end = -1
    if (TRIPLE_QUOTES.has(d) && (s.startsWith("'''", i) || s.startsWith('"""', i))) {
      end = scanQuoted(s, i, s.slice(i, i + 3), backslash)
    } else if (ch === "'") {
      // PostgreSQL's E'…' strings take backslash escapes although plain ones do not.
      const eString = d === 'postgresql' && /(?:^|[^A-Za-z0-9_$])[eE]$/.test(code)
      end = scanQuoted(s, i, "'", backslash || eString)
    } else if (ch === '"') {
      end = scanQuoted(s, i, '"', backslash)
    } else if (ch === '`') {
      end = scanQuoted(s, i, '`', false)
    } else if (ch === '[' && BRACKET_IDENTIFIERS.has(d)) {
      end = scanQuoted(s, i, ']', false)
    } else if (ch === '$' && DOLLAR_QUOTES.has(d) && !/[A-Za-z0-9_]$/.test(code)) {
      // `$1` is a parameter and `a$b` a name, so the tag must not start with a
      // digit and the `$` must not be glued to an identifier.
      DOLLAR_TAG.lastIndex = i
      const tag = DOLLAR_TAG.exec(s)
      if (tag) {
        const close = s.indexOf(tag[0], i + tag[0].length)
        end = close === -1 ? s.length : close + tag[0].length
      }
    }

    if (end !== -1) {
      push({ kind: 'quoted', text: s.slice(i, end) })
      i = end
      continue
    }

    code += ch
    i++
  }
  flush()
  return out
}

function isDirective(comment: string): boolean {
  return comment.startsWith('/*+') || comment.startsWith('/*!')
}

/**
 * Squeeze SQL onto one line without changing what it means.
 *
 * Whitespace inside string literals, quoted identifiers, dollar-quoted bodies
 * and comments is left exactly as written; everything else collapses to a
 * single space, dropped entirely next to `( ) , ;`. A `--` comment can only end
 * at a newline, so a kept line comment keeps its newline -- without it the
 * comment would swallow the rest of the query.
 */
export function minifySql(input: string, opts: Partial<SqlMinifyOptions> = {}): string {
  const dialect = opts.dialect ?? 'sql'
  const strip = opts.stripComments ?? false

  let out = ''
  // Whether whitespace (or a dropped comment) sits between the last emitted
  // piece and the next one.
  let gap = false

  for (const t of tokenize(input, dialect)) {
    if (t.kind === 'space' || (strip && t.kind === 'line')) {
      gap = true
      continue
    }
    if (strip && t.kind === 'block' && !isDirective(t.text)) {
      // `a/*x*/b` must become `a b`, not `ab`.
      gap = true
      continue
    }

    if (gap && out !== '' && !out.endsWith('\n')) {
      if (!TIGHT.has(out.at(-1)!) && !TIGHT.has(t.text[0]!)) out += ' '
    }
    gap = false
    out += t.text
    if (t.kind === 'line') out += '\n'
  }

  return out.trimEnd()
}
