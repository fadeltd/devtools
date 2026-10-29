import { escapeHtml, unescapeHtml } from './html.ts'
import { escapeJs, unescapeJs, type JsQuote } from './js.ts'
import { escapeJson, unescapeJson } from './json.ts'
import { escapeRegex, unescapeRegex } from './regex.ts'
import { ok, type EscapeResult } from './result.ts'
import { escapeShell, shellWarnings, unescapeShell } from './shell.ts'
import { escapeSql, sqlWarnings, unescapeSql, type SqlDialect } from './sql.ts'

export type EscapeMode = 'json' | 'js' | 'sql' | 'shell' | 'regex' | 'html'
export type EscapeDirection = 'escape' | 'unescape'

export interface EscapeOptions {
  /** Include the surrounding quotes (JSON, JavaScript, SQL). */
  wrap: boolean
  /** Escape every non-ASCII character (JSON, JavaScript). */
  asciiOnly: boolean
  /** JavaScript only. */
  quote: JsQuote
  /** SQL only. */
  sqlDialect: SqlDialect
}

export const DEFAULT_ESCAPE_OPTIONS: EscapeOptions = {
  wrap: true,
  asciiOnly: false,
  quote: '"',
  sqlDialect: 'standard',
}

export interface ModeInfo {
  mode: EscapeMode
  label: string
  /** Which of the options change this mode's escaping. Unescaping takes none. */
  options: { wrap: boolean; asciiOnly: boolean; quote: boolean; sqlDialect: boolean }
}

const NONE = { wrap: false, asciiOnly: false, quote: false, sqlDialect: false }

/** In menu order. The UI reads which controls to show from here. */
export const ESCAPE_MODES: readonly ModeInfo[] = [
  { mode: 'json', label: 'JSON string', options: { ...NONE, wrap: true, asciiOnly: true } },
  { mode: 'js', label: 'JavaScript string', options: { ...NONE, wrap: true, asciiOnly: true, quote: true } },
  { mode: 'sql', label: 'SQL string', options: { ...NONE, wrap: true, sqlDialect: true } },
  { mode: 'shell', label: 'Shell (POSIX sh)', options: NONE },
  { mode: 'regex', label: 'Regex literal', options: NONE },
  { mode: 'html', label: 'HTML entities', options: NONE },
]

export function escapeString(
  input: string,
  mode: EscapeMode,
  opts: EscapeOptions = DEFAULT_ESCAPE_OPTIONS,
): EscapeResult {
  switch (mode) {
    case 'json':
      return ok(escapeJson(input, { wrap: opts.wrap, asciiOnly: opts.asciiOnly }))
    case 'js':
      return ok(escapeJs(input, { wrap: opts.wrap, asciiOnly: opts.asciiOnly, quote: opts.quote }))
    case 'sql':
      return ok(escapeSql(input, { wrap: opts.wrap, dialect: opts.sqlDialect }), sqlWarnings(input, opts.sqlDialect))
    case 'shell':
      return ok(escapeShell(input), shellWarnings(input))
    case 'regex':
      return ok(escapeRegex(input))
    case 'html':
      return ok(escapeHtml(input))
  }
}

/**
 * Unescaping reads the quote style from the input itself (a literal that
 * starts and ends with a quote, or a bare body), so only the SQL dialect,
 * which changes what a backslash means, is taken from the options.
 */
export function unescapeString(
  input: string,
  mode: EscapeMode,
  opts: EscapeOptions = DEFAULT_ESCAPE_OPTIONS,
): EscapeResult {
  switch (mode) {
    case 'json':
      return unescapeJson(input)
    case 'js':
      return unescapeJs(input)
    case 'sql':
      return unescapeSql(input, opts.sqlDialect)
    case 'shell':
      return unescapeShell(input)
    case 'regex':
      return unescapeRegex(input)
    case 'html':
      return unescapeHtml(input)
  }
}

export function convertString(
  input: string,
  direction: EscapeDirection,
  mode: EscapeMode,
  opts: EscapeOptions = DEFAULT_ESCAPE_OPTIONS,
): EscapeResult {
  return direction === 'escape' ? escapeString(input, mode, opts) : unescapeString(input, mode, opts)
}
