import { useEffect, useState } from 'react'

export type AsyncValue<V> =
  | { status: 'pending' }
  | { status: 'done'; value: V }
  | { status: 'error'; error: string }

interface Settled<K, V> {
  key: K
  state: AsyncValue<V>
}

/**
 * `run(key)` whenever `key` changes, keyed by reference. The outcome is tagged
 * with the key it belongs to, so "pending" is derived during render rather than
 * set from the effect, and a stale result never shows against a newer key.
 *
 * `run` must be stable: a module-level function.
 */
export function useAsyncValue<K, V>(key: K, run: (key: K) => Promise<V>): AsyncValue<V> {
  const [settled, setSettled] = useState<Settled<K, V>>()

  useEffect(() => {
    let current = true
    run(key).then(
      (value) => {
        if (current) setSettled({ key, state: { status: 'done', value } })
      },
      (e: unknown) => {
        if (current) setSettled({ key, state: { status: 'error', error: e instanceof Error ? e.message : String(e) } })
      },
    )
    return () => {
      current = false
    }
  }, [key, run])

  return settled?.key === key ? settled.state : { status: 'pending' }
}
