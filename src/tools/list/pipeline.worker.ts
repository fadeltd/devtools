import { expose } from 'comlink'
import {
  parseLines,
  serializeLines,
  appliesNormalizationCheck,
  findNormalizationCollisions,
  runPipeline,
  type Op,
  type StepStat,
} from '@fadeltd/devtools-core/list'

export interface PipelineOutput {
  output: string
  steps: StepStat[]
  /** Lines that differ only by Unicode form, counted only where it matters. */
  collisions: number
}

/**
 * Runs off the main thread because a user regex in `filter` or `split` can
 * backtrack forever. Returns the serialised string rather than the LineDoc, so
 * one string crosses the boundary instead of a 100k-element array.
 */
const api = {
  run(text: string, ops: readonly Op[]): PipelineOutput {
    const { doc, steps } = runPipeline(parseLines(text), ops)
    const collisions = ops.some(appliesNormalizationCheck)
      ? findNormalizationCollisions(doc.lines)
      : 0
    return { output: serializeLines(doc), steps, collisions }
  },
}

export type PipelineApi = typeof api

expose(api)
