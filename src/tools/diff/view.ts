import { assessSize, type DiffTransform, type SizeVerdict } from '@fadeltd/devtools-core/diff'

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

/**
 * The view of the text as written, decided from the live text.
 *
 * Runs on the current state rather than a deferred copy: a deferred verdict
 * lags a render behind, which is exactly long enough for a dropped 5 MB
 * single-line file to be laid out on the main thread before it is refused.
 * `assessSize` is a couple of `indexOf` scans, so this is cheap per keystroke.
 *
 * A transform is built in a worker instead (see `transform-view.ts`); this
 * module deliberately does not import it, so the JSON parser and the line
 * sort stay out of the route chunk.
 */
export function plainView(left: string, right: string): DiffView {
  return { left, right, size: assessSize(left, right), problems: [], notes: [] }
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

export const TRANSFORM_BUSY: Record<DiffTransform, string> = {
  'sort-lines': 'Sorting lines…',
  json: 'Parsing and key-sorting JSON…',
}
