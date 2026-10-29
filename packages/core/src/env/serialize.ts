import { sortIssues } from './collect.ts'
import { SHELL_KEY, type EnvEntry, type EnvIssue } from './types.ts'

export type EnvOutputFormat = 'dotenv' | 'json' | 'shell' | 'docker'

export interface Serialized {
  text: string
  /** Entries the format cannot hold are left out and listed here, never mangled. */
  issues: EnvIssue[]
}

/** `{ "KEY": "value" }`, two-space indent, in entry order. Every value is a string. */
export function toJson(entries: readonly EnvEntry[]): string {
  if (entries.length === 0) return '{}'
  // Built by hand rather than via an object: keys can't start with a digit, so
  // nothing would be reordered today, but entry order is the contract.
  const body = entries.map((e) => `  ${JSON.stringify(e.key)}: ${JSON.stringify(e.value)}`)
  return `{\n${body.join(',\n')}\n}`
}

/*
 * Anything that would change meaning unquoted: whitespace (trimmed, and a line
 * break ends the value), `#` (a comment), quotes (start a quoted value), `\`
 * and `$` (escapes and ${VAR} expansion in some loaders), and control
 * characters. Everything else, unicode included, is safe bare.
 */
const NEEDS_QUOTES = /[\s#"'`\\$\p{Cc}]/u

/**
 * Pick the quoting that every common loader reads the same way:
 *
 * 1. Bare, when nothing in the value is special.
 * 2. Double quotes, when only whitespace or `#` is: no escapes are needed, so
 *    there is nothing for loaders to disagree about.
 * 3. Single quotes, when the value has `"`, `\` or `$` but no `'` and no line
 *    break. Node's dotenv ignores `\"` and `\\` inside double quotes and
 *    dotenv-expand expands `$` there, but single quotes are literal everywhere.
 * 4. Otherwise double quotes with `\\`, `\"`, `\n` and `\r` escapes.
 */
export function quoteDotenvValue(value: string): string {
  if (!NEEDS_QUOTES.test(value)) return value
  if (!/["\\$\r\n]/.test(value)) return `"${value}"`
  if (!value.includes("'") && !/[\r\n]/.test(value)) return `'${value}'`
  return `"${value.replace(/[\\"\n\r]/g, (c) => DOUBLE_ESCAPES[c]!)}"`
}

const DOUBLE_ESCAPES: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r' }

export function toDotenv(entries: readonly EnvEntry[]): string {
  return lines(entries.map((e) => `${e.key}=${quoteDotenvValue(e.value)}`))
}

/** POSIX single quotes: nothing inside is special, and `'` becomes `'\''`. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * `export KEY='value'` lines, safe to `source` from sh, bash or zsh. A key that
 * isn't a shell identifier would be a syntax error, so it is reported instead.
 */
export function toShell(entries: readonly EnvEntry[]): Serialized {
  const out: string[] = []
  const issues: EnvIssue[] = []
  for (const e of entries) {
    if (!SHELL_KEY.test(e.key)) {
      issues.push({
        severity: 'error',
        line: e.line,
        message: `${e.key} is not a valid shell variable name (only letters, digits and _), so it was left out.`,
      })
      continue
    }
    if (e.value.includes('\0')) {
      issues.push({ severity: 'error', line: e.line, message: `${e.key} contains a NUL character, which no shell variable can hold; left out.` })
      continue
    }
    out.push(`export ${e.key}=${shellQuote(e.value)}`)
  }
  return { text: lines(out), issues }
}

/**
 * `docker run --env-file` format. Docker reads everything after the first `=`
 * literally (quotes included) and one variable per line, so values are written
 * raw and a value with a line break can't be represented at all.
 *
 * Note that Compose's `env_file:` is a different, dotenv-like parser; use the
 * .env output for that.
 */
export function toDockerEnv(entries: readonly EnvEntry[]): Serialized {
  const out: string[] = []
  const issues: EnvIssue[] = []
  for (const e of entries) {
    if (/[\r\n\0]/.test(e.value)) {
      issues.push({
        severity: 'error',
        line: e.line,
        message: `${e.key} spans several lines, which an --env-file can't hold; left out.`,
      })
      continue
    }
    if (e.value !== e.value.trim()) {
      issues.push({
        severity: 'warning',
        line: e.line,
        message: `${e.key} starts or ends with whitespace. Docker keeps it, but it is easy to lose in an editor.`,
      })
    }
    out.push(`${e.key}=${e.value}`)
  }
  return { text: lines(out), issues }
}

export function serializeEnv(entries: readonly EnvEntry[], format: EnvOutputFormat): Serialized {
  switch (format) {
    case 'json':
      return { text: toJson(entries), issues: [] }
    case 'dotenv':
      return { text: toDotenv(entries), issues: [] }
    case 'shell':
      return sortedIssues(toShell(entries))
    case 'docker':
      return sortedIssues(toDockerEnv(entries))
  }
}

/** Line-based formats end with a newline, as a file should. */
function lines(xs: readonly string[]): string {
  return xs.length === 0 ? '' : `${xs.join('\n')}\n`
}

function sortedIssues(s: Serialized): Serialized {
  return { text: s.text, issues: sortIssues(s.issues) }
}
