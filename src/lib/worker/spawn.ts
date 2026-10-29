import { wrap, type Endpoint, type Remote } from 'comlink'

/**
 * Anything comlink can talk to that we can also kill. A `Worker` satisfies this
 * as-is; tests pass a `MessagePort` with a `terminate` bolted on.
 */
export type Terminable = Endpoint & { terminate: () => void }

/** A newer `run` replaced this one. Callers should ignore it silently. */
export class SupersededError extends Error {
  override name = 'SupersededError'
}

/** The user pressed Cancel. Worth showing, unlike a supersede. */
export class CancelledError extends Error {
  override name = 'CancelledError'
}

export interface RunOpts {
  /** Fired once if the run is still going after `slowMs`. Show a Cancel button. */
  onSlow?: () => void
}

export interface WorkerJob<Api> {
  run<R>(fn: (api: Remote<Api>) => Promise<R>, opts?: RunOpts): Promise<R>
  /** Kill the in-flight run, rejecting it with `CancelledError`. */
  cancel(): void
  /**
   * Kill the worker. The job stays usable -- the next `run` respawns -- which
   * is what lets a component's effect cleanup call this under StrictMode.
   */
  dispose(): void
}

interface InFlight {
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Run work in a worker that can always be stopped.
 *
 * A catastrophic-backtracking regex never yields, so there is no cooperative
 * abort: the only way out is `terminate()`. Hence the policy --
 *
 * - The worker is kept warm between runs, so typing does not pay a spawn per
 *   keystroke.
 * - A new run that arrives while one is still busy *terminates* the busy worker
 *   and respawns, rather than queueing behind something that may never finish.
 * - After `slowMs` the caller is told, so it can offer Cancel. Nothing is killed
 *   automatically: a 3 s sort of a big file is legitimate, and only the user
 *   knows whether to wait.
 */
export function createWorkerJob<Api>(
  spawn: () => Terminable,
  { slowMs = 2000 }: { slowMs?: number } = {},
): WorkerJob<Api> {
  let live: { worker: Terminable; api: Remote<Api> } | undefined
  let inflight: InFlight | undefined

  function kill() {
    live?.worker.terminate()
    live = undefined
  }

  function abort(error: Error) {
    if (!inflight) return
    const job = inflight
    inflight = undefined
    clearTimeout(job.timer)
    job.reject(error)
    // Only a busy worker is suspect; it may be stuck forever.
    kill()
  }

  return {
    run(fn, { onSlow } = {}) {
      abort(new SupersededError('superseded'))
      if (!live) {
        const worker = spawn()
        live = { worker, api: wrap<Api>(worker) }
      }
      const { api } = live

      return new Promise((resolve, reject) => {
        const job: InFlight = { reject, timer: setTimeout(() => onSlow?.(), slowMs) }
        inflight = job
        const settle = () => {
          if (inflight !== job) return false
          inflight = undefined
          clearTimeout(job.timer)
          return true
        }
        fn(api).then(
          (value) => settle() && resolve(value),
          (error: unknown) => settle() && reject(error),
        )
      })
    },
    cancel() {
      abort(new CancelledError('cancelled'))
    },
    dispose() {
      abort(new CancelledError('disposed'))
      kill()
    },
  }
}
