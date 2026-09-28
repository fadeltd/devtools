import { diffArrays } from 'diff'
import type { Keys } from './ignore'
import { splitLines, splitWords } from './tokens'

/**
 * Two-stage diff: align whole lines first, then refine each changed run of
 * lines at word level.
 *
 * Offsets come from each side's own tokens using jsdiff's per-part `count`,
 * never from a part's `value`. When keys make non-identical tokens equal,
 * jsdiff reports the *new* side's text for the common part, so summing `value`
 * lengths would drift on side A. Counting tokens is what lets the Ignore
 * toggles change what counts as equal without moving a single highlight.
 */

/** Flat `[fromA, toA, fromB, toB]` quads: character offsets into each side. */
export interface DiffResult {
  /** One quad per changed run of whole lines. What stats count. */
  lines: Int32Array
  /** Refined changes for highlighting. Each lies inside some `lines` quad. */
  changes: Int32Array
}

export interface EngineOptions {
  /** Comparison keys from `keysFor`; absent to compare exactly. */
  keys?: Keys | undefined
  /** Refine changed runs to word level. Off in the line-only size tier. */
  refine: boolean
  /** Clock for the refinement budget. Injected by tests. */
  now?: (() => number) | undefined
}

/** The line stage gives up past this, and the caller falls back to a cruder diff. */
export const LINE_TIMEOUT_MS = 250
/** Total time for refining every run in one call. Later runs highlight whole. */
export const REFINE_BUDGET_MS = 200
/** Cap on one run's word diff. */
const WORD_TIMEOUT_MS = 100
/** Runs longer than this on either side are highlighted whole. */
export const MAX_REFINE_CHARS = 20_000

interface Run {
  fromA: number
  toA: number
  fromB: number
  toB: number
}

/** `null` when the line stage could not finish within `LINE_TIMEOUT_MS`. */
export function computeDiff(a: string, b: string, opts: EngineOptions): DiffResult | null {
  const now = opts.now ?? Date.now
  const linesA = splitLines(a)
  const linesB = splitLines(b)
  const keysA = opts.keys ? linesA.map(opts.keys.line) : linesA
  const keysB = opts.keys ? linesB.map(opts.keys.line) : linesB

  // Common leading and trailing lines never reach Myers. That is most of the
  // work saved on real input, and nearly all of it on the per-keystroke slices
  // CodeMirror asks about.
  let head = 0
  const shorter = Math.min(keysA.length, keysB.length)
  while (head < shorter && keysA[head] === keysB[head]) head++
  let endA = keysA.length
  let endB = keysB.length
  while (endA > head && endB > head && keysA[endA - 1] === keysB[endB - 1]) {
    endA--
    endB--
  }

  // Lines whose key never occurs on the other side can never be matched, so
  // setting them aside leaves the longest common subsequence -- and so the
  // diff -- exactly as minimal, while Myers only sees lines that can pair up.
  // This is GNU diff's discard step, and it is what keeps scattered one-line
  // edits and unrelated documents from blowing the time limit: both shrink to
  // almost nothing.
  const inB = new Set(keysB.slice(head, endB))
  const inA = new Set(keysA.slice(head, endA))
  const keptA = keptLines(keysA, head, endA, inB)
  const keptB = keptLines(keysB, head, endB, inA)

  const parts = diffArrays(keptA.keys, keptB.keys, { timeout: LINE_TIMEOUT_MS })
  if (parts === undefined) return null

  const startsA = lineStarts(linesA)
  const startsB = lineStarts(linesB)
  const deadline = now() + REFINE_BUDGET_MS
  const lines: number[] = []
  const changes: number[] = []

  // Everything between two consecutive matched lines is one changed run.
  let nextA = head
  let nextB = head
  const emit = (toLineA: number, toLineB: number) => {
    if (toLineA === nextA && toLineB === nextB) return
    const run: Run = {
      fromA: startsA[nextA]!,
      toA: startsA[toLineA]!,
      fromB: startsB[nextB]!,
      toB: startsB[toLineB]!,
    }
    lines.push(run.fromA, run.toA, run.fromB, run.toB)
    refineRun(a, b, run, opts, deadline - now(), changes)
  }

  let ka = 0
  let kb = 0
  for (const part of parts) {
    if (part.removed) ka += part.count
    else if (part.added) kb += part.count
    else {
      for (let n = 0; n < part.count; n++) {
        const matchA = keptA.lines[ka++]!
        const matchB = keptB.lines[kb++]!
        emit(matchA, matchB)
        nextA = matchA + 1
        nextB = matchB + 1
      }
    }
  }
  emit(endA, endB)

  return { lines: Int32Array.from(lines), changes: Int32Array.from(changes) }
}

/** The lines in `[from, to)` whose key occurs on the other side, with their original indices. */
function keptLines(
  keys: readonly string[],
  from: number,
  to: number,
  other: ReadonlySet<string>,
): { keys: string[]; lines: number[] } {
  const kept: { keys: string[]; lines: number[] } = { keys: [], lines: [] }
  for (let i = from; i < to; i++) {
    if (other.has(keys[i]!)) {
      kept.keys.push(keys[i]!)
      kept.lines.push(i)
    }
  }
  return kept
}

/** `starts[i]` is where line `i` begins; `starts[lines.length]` is the total length. */
function lineStarts(lines: readonly string[]): Int32Array {
  const starts = new Int32Array(lines.length + 1)
  for (let i = 0; i < lines.length; i++) starts[i + 1] = starts[i]! + lines[i]!.length
  return starts
}

function refineRun(
  a: string,
  b: string,
  run: Run,
  opts: EngineOptions,
  budgetMs: number,
  out: number[],
): void {
  const { fromA, toA, fromB, toB } = run
  const tooBig = toA - fromA > MAX_REFINE_CHARS || toB - fromB > MAX_REFINE_CHARS
  if (!opts.refine || budgetMs <= 0 || fromA === toA || fromB === toB || tooBig) {
    out.push(fromA, toA, fromB, toB)
    return
  }

  const tokA = splitWords(a.slice(fromA, toA))
  const tokB = splitWords(b.slice(fromB, toB))
  const keysA = opts.keys ? tokA.map(opts.keys.word) : tokA
  const keysB = opts.keys ? tokB.map(opts.keys.word) : tokB
  const parts = diffArrays(keysA, keysB, { timeout: Math.min(WORD_TIMEOUT_MS, budgetMs) })
  if (parts === undefined) {
    out.push(fromA, toA, fromB, toB)
    return
  }

  let posA = fromA
  let posB = fromB
  let tA = 0
  let tB = 0
  let startA = -1
  let startB = -1
  for (const part of parts) {
    if (part.added || part.removed) {
      if (startA < 0) {
        startA = posA
        startB = posB
      }
      for (let n = 0; n < part.count; n++) {
        if (part.removed) posA += tokA[tA++]!.length
        else posB += tokB[tB++]!.length
      }
    } else {
      if (startA >= 0) {
        out.push(startA, posA, startB, posB)
        startA = -1
      }
      for (let n = 0; n < part.count; n++) {
        posA += tokA[tA++]!.length
        posB += tokB[tB++]!.length
      }
    }
  }
  if (startA >= 0) out.push(startA, posA, startB, posB)
}
