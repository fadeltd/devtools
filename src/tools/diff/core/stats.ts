import { buildLineIndex, offsetToLineCol } from '@/lib/offsets'

export interface ChangeRange {
  readonly fromA: number
  readonly toA: number
  readonly fromB: number
  readonly toB: number
}

export interface DiffStats {
  /** Lines present in B but not A. */
  addedLines: number
  /** Lines present in A but not B. */
  removedLines: number
  /** Lines that exist on both sides but differ. */
  changedLines: number
  addedChars: number
  removedChars: number
  /** Number of distinct change regions. */
  chunks: number
  identical: boolean
}

export const EMPTY_STATS: DiffStats = {
  addedLines: 0,
  removedLines: 0,
  changedLines: 0,
  addedChars: 0,
  removedChars: 0,
  chunks: 0,
  identical: true,
}

/**
 * Derive line/character stats from a change list.
 *
 * Computed from the diff itself rather than scraped back out of the rendered
 * view, so `+n -m ~k` is exact rather than approximated. A region that touches
 * lines on both sides counts as "changed" rather than being double-counted as
 * both an addition and a removal, which is what makes the numbers match what a
 * human sees in the gutter.
 */
export function diffStats(a: string, b: string, changes: readonly ChangeRange[]): DiffStats {
  if (changes.length === 0) return EMPTY_STATS

  const indexA = buildLineIndex(a)
  const indexB = buildLineIndex(b)

  let addedLines = 0
  let removedLines = 0
  let changedLines = 0
  let addedChars = 0
  let removedChars = 0

  for (const change of changes) {
    const aLen = change.toA - change.fromA
    const bLen = change.toB - change.fromB
    removedChars += aLen
    addedChars += bLen

    const aFrom = offsetToLineCol(indexA, change.fromA).line
    const aTo = offsetToLineCol(indexA, Math.max(change.fromA, change.toA - 1)).line
    const bFrom = offsetToLineCol(indexB, change.fromB).line
    const bTo = offsetToLineCol(indexB, Math.max(change.fromB, change.toB - 1)).line

    const aLines = aLen === 0 ? 0 : aTo - aFrom + 1
    const bLines = bLen === 0 ? 0 : bTo - bFrom + 1

    if (aLines === 0) {
      addedLines += bLines
    } else if (bLines === 0) {
      removedLines += aLines
    } else {
      // Both sides touched: the overlap is a modification, and any excess on
      // either side is a genuine addition or removal.
      const common = Math.min(aLines, bLines)
      changedLines += common
      addedLines += bLines - common
      removedLines += aLines - common
    }
  }

  return {
    addedLines,
    removedLines,
    changedLines,
    addedChars,
    removedChars,
    chunks: changes.length,
    identical: false,
  }
}

export function formatStats(s: DiffStats): string {
  if (s.identical) return 'identical'
  const parts: string[] = []
  if (s.addedLines > 0) parts.push(`+${s.addedLines}`)
  if (s.removedLines > 0) parts.push(`−${s.removedLines}`)
  if (s.changedLines > 0) parts.push(`~${s.changedLines}`)
  return parts.length > 0 ? parts.join(' ') : 'whitespace only'
}

export interface SizeVerdict {
  tier: 'ok' | 'line-only' | 'refuse'
  reason: string | null
  longestLine: number
}

/**
 * Guardrails, so a pathological input degrades visibly instead of hanging.
 *
 * The single-enormous-line case matters as much as total size: CodeMirror
 * handles a 5MB document fine but not a 5MB document that is one line.
 */
export function assessSize(a: string, b: string): SizeVerdict {
  const longestLine = Math.max(longestLineOf(a), longestLineOf(b))
  const bytes = Math.max(a.length, b.length)

  if (bytes > 8_000_000) {
    return {
      tier: 'refuse',
      reason: 'Each side must be under 8 MB. Use `git diff` or `diff` on the command line.',
      longestLine,
    }
  }
  if (longestLine > 200_000) {
    return {
      tier: 'refuse',
      reason: `One line is ${longestLine.toLocaleString('en-US')} characters long, which cannot be displayed usefully.`,
      longestLine,
    }
  }
  if (bytes > 2_000_000) {
    return {
      tier: 'line-only',
      reason: 'Over 2 MB — word-level highlighting is off to keep the view responsive.',
      longestLine,
    }
  }
  return { tier: 'ok', reason: null, longestLine }
}

function longestLineOf(text: string): number {
  let longest = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      if (i - start > longest) longest = i - start
      start = i + 1
    }
  }
  return Math.max(longest, text.length - start)
}
