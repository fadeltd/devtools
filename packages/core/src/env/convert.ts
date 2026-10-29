import { parseDotenv } from './dotenv.ts'
import { parseJsonEnv } from './json.ts'
import { serializeEnv, type EnvOutputFormat } from './serialize.ts'
import { sortIssues } from './collect.ts'
import type { EnvEntry, EnvIssue } from './types.ts'

export type EnvInputFormat = 'dotenv' | 'json'

/**
 * JSON when the first non-blank character opens an object or array. A .env
 * line can never start with `{` or `[` (it would be an invalid key), so there
 * is no ambiguity to guess about.
 */
export function detectEnvFormat(text: string): EnvInputFormat {
  const m = /^[\s﻿]*([\s\S])/.exec(text)
  return m !== null && (m[1] === '{' || m[1] === '[') ? 'json' : 'dotenv'
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

export function convertEnv(text: string, options: ConvertEnvOptions): ConvertEnvResult {
  const from = options.from === 'auto' ? detectEnvFormat(text) : options.from
  if (text.trim() === '') return { from, entries: [], output: '', issues: [] }

  const doc = from === 'json' ? parseJsonEnv(text, { flatten: options.flatten }) : parseDotenv(text)
  const out = serializeEnv(doc.entries, options.to)
  return { from, entries: doc.entries, output: out.text, issues: sortIssues([...doc.issues, ...out.issues]) }
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
