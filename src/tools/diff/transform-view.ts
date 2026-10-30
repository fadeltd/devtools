import {
  assessSize,
  transformForDiff,
  MAX_DIFF_CHARS,
  type DiffTransform,
  type TransformResult,
} from '@fadeltd/devtools-core/diff'
import { plainView, type DiffView } from './view'

// One entry per side is enough: in a transform the panes are read-only, so a
// side changes only when a file replaces it, and the other side should not be
// re-parsed or re-sorted when that happens. It lives in the worker, which is
// kept warm between runs.
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
 * Both sides rewritten for comparison, with the size verdict judged on the
 * rewritten text. Runs in `transform.worker.ts`: a 100k-line sort or a
 * multi-MB JSON parse takes long enough to freeze the page.
 */
export function transformView(left: string, right: string, kind: DiffTransform): DiffView {
  // Past the hard cap there is nothing to show, so skip parsing or sorting it.
  // DiffTool does not send such text here; this keeps the function safe alone.
  if (Math.max(left.length, right.length) > MAX_DIFF_CHARS) return plainView(left, right)

  const problems: string[] = []
  const notes: string[] = []
  const side = (text: string, name: 'Left' | 'Right'): string => {
    const r = transformCached(text, kind)
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
