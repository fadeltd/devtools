export interface Debounced<A extends unknown[]> {
  (...args: A): void
  /** Run any pending call immediately. Used on pagehide/visibilitychange. */
  flush: () => void
  cancel: () => void
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: A | undefined

  const run = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (pending) {
      const args = pending
      pending = undefined
      fn(...args)
    }
  }

  const debounced = ((...args: A) => {
    pending = args
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(run, ms)
  }) as Debounced<A>

  debounced.flush = run
  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    pending = undefined
  }
  return debounced
}
