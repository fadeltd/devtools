import { expose } from 'comlink'
import type { DiffTransform } from '@fadeltd/devtools-core/diff'
import { transformView } from './transform-view'
import type { DiffView } from './view'

/**
 * Off the main thread because a transform of a large side is slow enough to
 * freeze the page when toggled (100k lines sort in ~330 ms, a 1.8 MB JSON
 * file parses and re-prints in ~250 ms), and because it keeps the JSON parser
 * and the list sort out of the diff route chunk.
 */
const api = {
  view(left: string, right: string, kind: DiffTransform): DiffView {
    return transformView(left, right, kind)
  },
}

export type DiffTransformApi = typeof api

expose(api)
