import { captureGroupNames, compileRegex } from './compile.ts'
import { findMatches, MATCH_LIMIT, type MatchResult } from './match.ts'
import { replacementIssues, replaceWith, type ReplacementIssue, type ReplaceResult } from './replace.ts'

export type RegexMode = 'match' | 'replace'

export interface RegexRunInput {
  pattern: string
  flags: string
  text: string
  mode: RegexMode
  replacement: string
  limit?: number
}

export type RegexRun =
  | { ok: false; kind: 'flags' | 'pattern'; message: string }
  | {
      ok: true
      groupNames: Array<string | null>
      /** Set in match mode. */
      match: MatchResult | null
      /** Set in replace mode. */
      replace: (ReplaceResult & { issues: ReplacementIssue[] }) | null
    }

/**
 * Everything the regex tester shows for one input, in one call, so a worker
 * can run it whole. Never throws for a bad pattern or flags; it does run the
 * pattern, so it belongs in a worker that can be terminated.
 */
export function runRegex({ pattern, flags, text, mode, replacement, limit = MATCH_LIMIT }: RegexRunInput): RegexRun {
  const compiled = compileRegex(pattern, flags)
  if (!compiled.ok) return compiled
  const groupNames = captureGroupNames(pattern, flags)
  if (mode === 'replace') {
    return {
      ok: true,
      groupNames,
      match: null,
      replace: { ...replaceWith(text, compiled.regex, replacement), issues: replacementIssues(replacement, groupNames) },
    }
  }
  return { ok: true, groupNames, match: findMatches(text, compiled.regex, { limit }), replace: null }
}
