import { Change, diff, type DiffConfig } from '@codemirror/merge'
import { computeDiff } from './core/engine'
import { keysFor, type IgnoreOptions } from './core/ignore'

export interface DiffSettings {
  ignore: IgnoreOptions
  /** Word-level refinement; off in the line-only size tier. */
  refine: boolean
}

export interface DiffOutput {
  /** Changed line runs: what the stats count and chunk navigation steps through. */
  lines: readonly Change[]
  /** What the view highlights. */
  changes: readonly Change[]
}

// One entry is enough: the toolbar stats and the view build ask for the same
// full documents back to back, and this turns that into one computation.
let last: { a: string; b: string; key: string; out: DiffOutput } | null = null

/** The diff the Diff tool shows, for both the view and the stats. */
export function diffFor(a: string, b: string, settings: DiffSettings): DiffOutput {
  const { ignore, refine } = settings
  const key = `${+ignore.whitespace}${+ignore.case}${+ignore.trim}${+refine}`
  if (last !== null && last.key === key && last.a === a && last.b === b) return last.out

  const result = computeDiff(a, b, { keys: keysFor(ignore), refine })
  let out: DiffOutput
  if (result === null) {
    // Too different to line-align in time. Fall back to CodeMirror's own diff
    // with the scanLimit the view has always used: coarse, but it never hangs.
    // The ignore toggles cannot apply here; staying responsive matters more.
    const crude = diff(a, b, { scanLimit: 500 })
    out = { lines: crude, changes: crude }
  } else {
    out = { lines: toChanges(result.lines), changes: toChanges(result.changes) }
  }
  last = { a, b, key, out }
  return out
}

/**
 * `diffConfig` for the merge view. `override` is synchronous and is also
 * called on slices while typing, which may start mid-line. The engine is
 * correct on any substring pair, so that is fine.
 */
export function makeDiffConfig(settings: DiffSettings): DiffConfig {
  return { override: (a, b) => diffFor(a, b, settings).changes }
}

function toChanges(quads: Int32Array): Change[] {
  const out: Change[] = []
  for (let i = 0; i < quads.length; i += 4) {
    out.push(new Change(quads[i]!, quads[i + 1]!, quads[i + 2]!, quads[i + 3]!))
  }
  return out
}
