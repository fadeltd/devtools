import { buildLineIndex, offsetToLineCol } from '../text/offsets.ts'
import { captureGroupNames } from './compile.ts'

export interface RegexGroup {
  /** 1-based, as in `$1`. */
  number: number
  name: string | null
  /** Null when the group did not take part in the match. */
  text: string | null
  start: number | null
  end: number | null
}

export interface RegexMatch {
  /** UTF-16 offsets, as a textarea's selection uses them. */
  start: number
  end: number
  text: string
  /** 1-based; the column counts UTF-16 code units. */
  line: number
  column: number
  groups: RegexGroup[]
}

export interface MatchResult {
  matches: RegexMatch[]
  /** More matches exist past `limit`. */
  truncated: boolean
  /** Each capture group's name, or null, by group number - 1. */
  groupNames: Array<string | null>
}

/** Enough for any table someone reads; past it, the count says "10,000+". */
export const MATCH_LIMIT = 10_000

/**
 * What a JavaScript program would get from this regex: every match with `g`
 * (as `matchAll` does), otherwise only the first (as `exec` does). Each
 * match carries its line and column and every group's span.
 *
 * An empty match moves on by one character (a whole code point with `u` or
 * `v`), as the engine itself does, so `a*` over "baa" finds "", "aa", "".
 * With `g` and `y` together, matching stops at the first gap.
 *
 * This runs the user's pattern: call it in a worker, which can be terminated
 * if the pattern backtracks without end.
 */
export function findMatches(text: string, regex: RegExp, { limit = MATCH_LIMIT } = {}): MatchResult {
  const groupNames = captureGroupNames(regex.source, regex.flags)
  // d records group spans and changes nothing about what matches.
  const re = regex.hasIndices ? new RegExp(regex) : new RegExp(regex.source, `${regex.flags}d`)
  re.lastIndex = 0
  const unicode = re.unicode || re.flags.includes('v')

  const raw: RegExpExecArray[] = []
  let truncated = false
  for (;;) {
    const m = re.exec(text)
    if (m === null) break
    if (raw.length === limit) {
      truncated = true
      break
    }
    raw.push(m)
    if (!re.global) break
    if (m[0] === '') re.lastIndex = advance(text, re.lastIndex, unicode)
  }

  const lines = raw.length > 0 ? buildLineIndex(text) : null
  const matches = raw.map((m): RegexMatch => {
    const { line, column } = offsetToLineCol(lines!, m.index)
    const indices = m.indices!
    return {
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
      line,
      column,
      groups: groupNames.map((name, i) => {
        const span = indices[i + 1]
        return {
          number: i + 1,
          name,
          text: m[i + 1] ?? null,
          start: span?.[0] ?? null,
          end: span?.[1] ?? null,
        }
      }),
    }
  })
  return { matches, truncated, groupNames }
}

/** The engine's AdvanceStringIndex: past a whole surrogate pair in unicode mode. */
function advance(text: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= text.length) return index + 1
  const c = text.charCodeAt(index)
  if (c < 0xd800 || c > 0xdbff) return index + 1
  const next = text.charCodeAt(index + 1)
  return next >= 0xdc00 && next <= 0xdfff ? index + 2 : index + 1
}
