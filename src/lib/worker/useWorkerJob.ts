import type { Remote } from 'comlink'
import { useCallback, useEffect, useState } from 'react'
import { CancelledError, createWorkerJob, SupersededError, type Terminable } from './spawn'

export type JobStatus = 'running' | 'slow' | 'done' | 'error' | 'cancelled'

export interface WorkerJobState<R> {
  status: JobStatus
  /** The last *successful* result -- kept while a newer run is in flight. */
  result: R | undefined
  error: string | undefined
  cancel: () => void
}

interface Outcome<I> {
  input: I
  status: Exclude<JobStatus, 'running'>
  error?: string
}

/**
 * Re-run `call(api, input)` in a worker whenever `input` changes.
 *
 * `spawn` and `call` must be stable (module-level functions): the job is created
 * once, and the effect keys on `call`. `input` is compared by reference, so pass
 * a memoised `useDeferredValue` snapshot -- that also keeps typing responsive.
 */
export function useWorkerJob<Api, I, R>(
  spawn: () => Terminable,
  call: (api: Remote<Api>, input: I) => Promise<R>,
  input: I,
): WorkerJobState<R> {
  const [job] = useState(() => createWorkerJob<Api>(spawn))
  const [result, setResult] = useState<R>()
  // Tagged with the input it belongs to, so "running" is derived during render:
  // until this input has an outcome, its run is in flight.
  const [outcome, setOutcome] = useState<Outcome<I>>()

  useEffect(() => {
    let current = true
    job
      .run((api) => call(api, input), {
        onSlow: () => current && setOutcome({ input, status: 'slow' }),
      })
      .then(
        (value) => {
          if (!current) return
          setResult(value)
          setOutcome({ input, status: 'done' })
        },
        (e: unknown) => {
          if (!current || e instanceof SupersededError) return
          if (e instanceof CancelledError) {
            setOutcome({ input, status: 'cancelled' })
            return
          }
          setOutcome({ input, status: 'error', error: e instanceof Error ? e.message : String(e) })
        },
      )
    return () => {
      current = false
    }
  }, [job, call, input])

  useEffect(() => () => job.dispose(), [job])

  const cancel = useCallback(() => job.cancel(), [job])
  const settled = outcome?.input === input ? outcome : undefined
  return {
    status: settled?.status ?? 'running',
    result,
    error: settled?.error,
    cancel,
  }
}
