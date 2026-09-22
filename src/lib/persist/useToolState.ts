import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TOOLS_BY_SLUG, type ToolSlug } from '@/lib/registry'
import { debounce } from '@/lib/util/debounce'
import { readIdb, removeIdb, writeIdb } from './idb'
import { localKey, readLocal, removeLocal, writeLocal } from './store'

export type PersistStatus = 'saved' | 'ephemeral' | 'error'

export interface ToolStateOpts<T> {
  /** ms to coalesce writes. Default 400. */
  debounceMs?: number
  /** Strip fields before writing. Return the subset to persist. */
  redact?: (state: T) => Partial<T>
  /** Force-disable persistence at the call site, regardless of the registry. */
  ephemeral?: boolean
}

export interface ToolStateHandle<T> {
  state: T
  setState: (next: T | ((prev: T) => T)) => void
  /** True until an idb-backed value has loaded. Always false for local/none. */
  hydrating: boolean
  /** Reset to `initial` and delete the stored record. */
  reset: () => void
  status: PersistStatus
}

/**
 * Per-tool last-used state.
 *
 * The slug is the only key input: the hook reads `store` and `stateVersion` off
 * the registry, so persistence policy cannot drift from the tool's declaration.
 * In particular a tool declaring `store: { kind: 'none' }` gets plain useState
 * here and a visible "Not saved" badge from ToolFrame.
 */
export function useToolState<T>(
  slug: ToolSlug,
  initial: T,
  opts: ToolStateOpts<T> = {},
): ToolStateHandle<T> {
  const tool = TOOLS_BY_SLUG[slug]
  const version = tool.stateVersion
  const kind = opts.ephemeral === true ? 'none' : tool.store.kind

  const { debounceMs = 400, redact } = opts

  // Captured once, so `reset` and hydration always fall back to the first
  // `initial` even if the caller passes a fresh object literal each render.
  // Only read inside callbacks and effects, never during render.
  const initialRef = useRef(initial)

  // localStorage is synchronous, so read it during the initial render -- that is
  // the whole reason small state lives there: no hydration flicker.
  const [state, setStateRaw] = useState<T>(() => {
    if (kind !== 'local') return initial
    const stored = readLocal<T>(slug, version)
    return stored === undefined ? initial : { ...initial, ...stored }
  })

  const [hydrating, setHydrating] = useState(kind === 'idb')
  const [status, setStatus] = useState<PersistStatus>(kind === 'none' ? 'ephemeral' : 'saved')

  // idb is async: hydrate after mount, and do not clobber edits made meanwhile.
  const dirtyRef = useRef(false)
  useEffect(() => {
    if (kind !== 'idb') return
    let cancelled = false
    void readIdb<T>(slug, version).then((stored) => {
      if (cancelled) return
      if (stored !== undefined && !dirtyRef.current) {
        setStateRaw({ ...initialRef.current, ...stored })
      }
      setHydrating(false)
    })
    return () => {
      cancelled = true
    }
  }, [kind, slug, version])

  const write = useCallback(
    (value: T) => {
      const payload = (redact ? redact(value) : value) as T
      if (kind === 'local') {
        const result = writeLocal(slug, version, payload)
        setStatus(result === 'ok' ? 'saved' : 'error')
      } else if (kind === 'idb') {
        void writeIdb(slug, version, payload).then((ok) => setStatus(ok ? 'saved' : 'error'))
      }
    },
    [kind, redact, slug, version],
  )

  const flushRef = useRef<(() => void) | null>(null)
  const debouncedWrite = useMemo(() => {
    if (kind === 'none') return null
    return debounce((value: T) => write(value), debounceMs)
  }, [kind, debounceMs, write])

  useEffect(() => {
    flushRef.current = debouncedWrite ? () => debouncedWrite.flush() : null
    return () => debouncedWrite?.cancel()
  }, [debouncedWrite])

  const setState = useCallback(
    (next: T | ((prev: T) => T)) => {
      setStateRaw((prev) => {
        const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        dirtyRef.current = true
        debouncedWrite?.(value)
        return value
      })
    },
    [debouncedWrite],
  )

  // Force a write when the tab is backgrounded or closed. beforeunload is not
  // reliable on mobile Safari -- exactly where a lost write would hurt most.
  useEffect(() => {
    if (kind === 'none') return
    const flush = () => flushRef.current?.()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [kind])

  // Another tab edited the same tool: adopt its value rather than clobber it.
  useEffect(() => {
    if (kind !== 'local') return
    const key = localKey(slug)
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return
      if (e.newValue === null) {
        setStateRaw(initialRef.current)
        return
      }
      const stored = readLocal<T>(slug, version)
      if (stored !== undefined) setStateRaw({ ...initialRef.current, ...stored })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [kind, slug, version])

  const reset = useCallback(() => {
    debouncedWrite?.cancel()
    dirtyRef.current = false
    setStateRaw(initialRef.current)
    if (kind === 'local') removeLocal(localKey(slug))
    else if (kind === 'idb') void removeIdb(slug)
    setStatus(kind === 'none' ? 'ephemeral' : 'saved')
  }, [debouncedWrite, kind, slug])

  return { state, setState, hydrating, reset, status }
}
