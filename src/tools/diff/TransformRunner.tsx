import { useEffect } from 'react'
import type { Remote } from 'comlink'
import type { DiffTransform } from '@fadeltd/devtools-core/diff'
import { useWorkerJob, type JobStatus } from '@/lib/worker/useWorkerJob'
import type { DiffTransformApi } from './transform.worker'
import type { DiffView } from './view'

export interface TransformInput {
  left: string
  right: string
  kind: DiffTransform
}

/** A finished view, tagged with the input it was built from. */
export interface TransformOutcome {
  input: TransformInput
  view: DiffView
}

export interface TransformJob {
  /** The input `status` and `error` describe. */
  input: TransformInput
  status: JobStatus
  /** The last finished view, which may belong to an older input. */
  result: TransformOutcome | undefined
  error: string | undefined
  cancel: () => void
}

// Module-level so useWorkerJob sees stable references.
function spawnTransformer() {
  return new Worker(new URL('./transform.worker.ts', import.meta.url), { type: 'module' })
}

async function runTransform(api: Remote<DiffTransformApi>, input: TransformInput): Promise<TransformOutcome> {
  return { input, view: await api.view(input.left, input.right, input.kind) }
}

/**
 * Builds a transformed view in a worker and reports on it. Renders nothing.
 *
 * A component rather than a hook in DiffTool so that it is mounted only while
 * a transform is on: useWorkerJob spawns its worker on the first run, and most
 * visits to the Diff tool never transform anything. Unmounting ("Show
 * original") also kills a run that is still going.
 */
export function TransformRunner({
  input,
  onChange,
}: {
  input: TransformInput
  /** Must be stable (a state setter). Called with null on unmount. */
  onChange: (job: TransformJob | null) => void
}) {
  const { status, result, error, cancel } = useWorkerJob(spawnTransformer, runTransform, input)

  useEffect(() => {
    onChange({ input, status, result, error, cancel })
  }, [input, status, result, error, cancel, onChange])

  useEffect(() => () => onChange(null), [onChange])

  return null
}
