import { parseDotenv } from './dotenv.ts'
import { parseJsonEnv } from './json.ts'
import { serializeEnv, type EnvOutputFormat } from './serialize.ts'
import { parseShellExports } from './shell.ts'
import { sortIssues } from './collect.ts'
import type { EnvDoc, EnvEntry, EnvIssue } from './types.ts'

export type EnvInputFormat = 'dotenv' | 'json' | 'shell'

/** A line that assigns with an `export ` prefix, the one sign of a shell file worth trusting. */
const EXPORT_LINE = /^[ \t]*export[ \t]/m

const hasErrors = (doc: EnvDoc) => doc.issues.some((i) => i.severity === 'error')

/**
 * What the shell reader is given: no BOM, and CRLF as LF. The .env reader gets
 * the same from parseLines. A lone CR is left alone, since inside single quotes
 * it is part of the value.
 */
function shellText(text: string): string {
  return text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')
}

/**
 * Detect and parse in one pass, so `convertEnv` does not parse twice.
 *
 * JSON when the first non-blank character opens an object or array: a .env
 * line can never start with `{` or `[` (it would be an invalid key), so there
 * is no ambiguity to guess about.
 *
 * Shell only when .env cannot read the text and the shell reader can, and the
 * text has an `export` line. `export A=1` is valid in both and means the same,
 * and where both read a file without error but disagree (`"a\nb"` is a line
 * break to dotenv and a backslash and `n` to sh) the text is far more likely
 * meant for dotenv, which is what most such files are loaded with. What only sh reads is `'it'\''s'`, `A='x'; B='y'`
 * and other quoting that dotenv reports as an error, so that is the signal.
 */
function detect(text: string): { from: EnvInputFormat; doc?: EnvDoc } {
  const m = /^[\s\uFEFF]*([\s\S])/.exec(text)
  if (m !== null && (m[1] === '{' || m[1] === '[')) return { from: 'json' }
  const dotenv = parseDotenv(text)
  if (!hasErrors(dotenv) || !EXPORT_LINE.test(text)) return { from: 'dotenv', doc: dotenv }
  const shell = parseShellExports(shellText(text))
  if (shell.entries.length > 0 && !hasErrors(shell)) return { from: 'shell', doc: shell }
  return { from: 'dotenv', doc: dotenv }
}

export function detectEnvFormat(text: string): EnvInputFormat {
  return detect(text).from
}

export interface ConvertEnvOptions {
  from: EnvInputFormat | 'auto'
  to: EnvOutputFormat
  /** JSON input only: flatten nested objects into `A__B` keys. */
  flatten: boolean
}

export interface ConvertEnvResult {
  /** The input format actually used, after auto-detection. */
  from: EnvInputFormat
  entries: EnvEntry[]
  output: string
  /** Parse and serialize issues together, by input line. */
  issues: EnvIssue[]
}

function parse(text: string, from: EnvInputFormat, flatten: boolean): EnvDoc {
  switch (from) {
    case 'json':
      return parseJsonEnv(text, { flatten })
    case 'shell':
      return parseShellExports(shellText(text))
    case 'dotenv':
      return parseDotenv(text)
  }
}

export function convertEnv(text: string, options: ConvertEnvOptions): ConvertEnvResult {
  if (text.trim() === '') {
    const from = options.from === 'auto' ? detectEnvFormat(text) : options.from
    return { from, entries: [], output: '', issues: [] }
  }
  const picked = options.from === 'auto' ? detect(text) : { from: options.from }
  const doc = picked.doc ?? parse(text, picked.from, options.flatten)
  const out = serializeEnv(doc.entries, options.to)
  return { from: picked.from, entries: doc.entries, output: out.text, issues: sortIssues([...doc.issues, ...out.issues]) }
}

export const MASK = '••••'

/**
 * Same keys, every non-empty value replaced, for a preview that is safe to
 * screen-share. An empty value stays empty: that it is empty is often the very
 * thing being checked, and it reveals nothing.
 */
export function maskEntries(entries: readonly EnvEntry[]): EnvEntry[] {
  return entries.map((e) => (e.value === '' ? e : { ...e, value: MASK }))
}
