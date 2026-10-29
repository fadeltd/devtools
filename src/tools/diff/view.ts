import {
  assessSize,
  transformForDiff,
  MAX_DIFF_CHARS,
  type DiffTransform,
  type SizeVerdict,
  type TransformResult,
} from '@fadeltd/devtools-core/diff'

export type Transform = 'none' | DiffTransform

/** What the panes, the stats and the patch are built from. */
export interface DiffView {
  left: string
  right: string
  /** Judged on the text actually shown, so a transform's output is guarded too. */
  size: SizeVerdict
  /** A side that could not be transformed, and is shown as written instead. */
  problems: string[]
  notes: string[]
}

// One entry per side is enough: in a transform the panes are read-only, so a
// side changes only when a file replaces it, and the other side should not be
// re-parsed or re-sorted when that happens.
const cache: Array<{ text: string; kind: DiffTransform; result: TransformResult }> = []

function transformCached(text: string, kind: DiffTransform): TransformResult {
  const hit = cache.find((e) => e.kind === kind && e.text === text)
  if (hit) return hit.result
  const result = transformForDiff(text, kind)
  cache.unshift({ text, kind, result })
  cache.length = Math.min(cache.length, 2)
  return result
}

/**
 * Decide what reaches CodeMirror, from the live text.
 *
 * Runs on the current state rather than a deferred copy: a deferred verdict
 * lags a render behind, which is exactly long enough for a dropped 5 MB
 * single-line file to be laid out on the main thread before it is refused.
 * `assessSize` is a couple of `indexOf` scans, so this is cheap per keystroke.
 */
export function prepareView(left: string, right: string, transform: Transform): DiffView {
  // Past the hard cap there is nothing to show, so skip parsing or sorting it.
  if (transform === 'none' || Math.max(left.length, right.length) > MAX_DIFF_CHARS) {
    return { left, right, size: assessSize(left, right), problems: [], notes: [] }
  }

  const problems: string[] = []
  const notes: string[] = []
  const side = (text: string, name: 'Left' | 'Right'): string => {
    const r = transformCached(text, transform)
    if (!r.ok) {
      problems.push(`${name} side is not valid JSON: ${r.error}. Showing it as written.`)
      return text
    }
    for (const note of r.notes) notes.push(`${name}: ${note}`)
    return r.text
  }

  const shownLeft = side(left, 'Left')
  const shownRight = side(right, 'Right')
  return { left: shownLeft, right: shownRight, size: assessSize(shownLeft, shownRight), problems, notes }
}

export const TRANSFORM_LABELS: Record<Transform, string> = {
  none: 'As written',
  'sort-lines': 'Sorted lines',
  json: 'Key-sorted JSON',
}

export const TRANSFORM_BANNERS: Record<DiffTransform, string> = {
  'sort-lines': 'Showing line-sorted view.',
  json: 'Showing key-sorted JSON view.',
}
