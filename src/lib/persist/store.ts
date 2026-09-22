/**
 * localStorage access, wrapped so that failure is never fatal.
 *
 * Safari private mode throws on the very first write, so every entry point sits
 * behind a probe that falls back to an in-memory Map. A tool must keep working
 * when storage does not.
 */

export const KEY_PREFIX = 'dt:'
const LOCAL_PREFIX = `${KEY_PREFIX}s:`

/** Envelope: v = ToolDef.stateVersion, t = last-used epoch ms (drives LRU). */
export interface Envelope<T> {
  v: number
  t: number
  data: T
}

/**
 * A `local` value larger than this is a bug: the tool is mis-declared and
 * should be using `store: 'idb'`. We skip the write rather than throw.
 */
export const LOCAL_MAX_BYTES = 64 * 1024

export type WriteResult = 'ok' | 'skipped-too-large' | 'error'

function probe(): Storage | null {
  try {
    const k = `${KEY_PREFIX}probe`
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return localStorage
  } catch {
    return null
  }
}

const memory = new Map<string, string>()
let backing: Storage | null | undefined

function store(): Storage | null {
  if (backing === undefined) backing = probe()
  return backing
}

function getRaw(key: string): string | null {
  const s = store()
  if (!s) return memory.get(key) ?? null
  try {
    return s.getItem(key)
  } catch {
    return null
  }
}

function setRaw(key: string, value: string): void {
  const s = store()
  if (!s) {
    memory.set(key, value)
    return
  }
  s.setItem(key, value)
}

export function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'QuotaExceededError' ||
      // Firefox's legacy name, and Safari's legacy code.
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22)
  )
}

export function localKey(slug: string): string {
  return `${LOCAL_PREFIX}${slug}`
}

function listLocalKeys(): string[] {
  const s = store()
  if (!s) return [...memory.keys()].filter((k) => k.startsWith(LOCAL_PREFIX))
  const out: string[] = []
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k?.startsWith(LOCAL_PREFIX)) out.push(k)
    }
  } catch {
    /* ignore */
  }
  return out
}

/** Drop the least-recently-used half of our own keys to make room. */
function evictHalf(exceptKey: string): number {
  const entries: Array<{ key: string; t: number }> = []
  for (const key of listLocalKeys()) {
    if (key === exceptKey) continue
    let t = 0
    try {
      t = (JSON.parse(getRaw(key) ?? '{}') as Envelope<unknown>).t ?? 0
    } catch {
      /* unparseable: treat as oldest so it gets evicted first */
    }
    entries.push({ key, t })
  }
  entries.sort((a, b) => a.t - b.t)
  const victims = entries.slice(0, Math.ceil(entries.length / 2))
  for (const v of victims) removeLocal(v.key)
  return victims.length
}

export function readLocal<T>(slug: string, version: number): T | undefined {
  const raw = getRaw(localKey(slug))
  if (raw === null) return undefined
  try {
    const env = JSON.parse(raw) as Envelope<T>
    // Version mismatch is discarded by design -- there are no migrations.
    if (env.v !== version) return undefined
    return env.data
  } catch {
    return undefined
  }
}

export function writeLocal<T>(slug: string, version: number, data: T): WriteResult {
  const key = localKey(slug)
  let payload: string
  try {
    payload = JSON.stringify({ v: version, t: Date.now(), data } satisfies Envelope<T>)
  } catch {
    return 'error'
  }

  if (payload.length > LOCAL_MAX_BYTES) {
    if (import.meta.env.DEV) {
      console.warn(
        `[persist] "${slug}" wrote ${payload.length}B to localStorage (cap ${LOCAL_MAX_BYTES}B). ` +
          `Declare store: { kind: 'idb' } in the registry instead.`,
      )
    }
    return 'skipped-too-large'
  }

  try {
    setRaw(key, payload)
    return 'ok'
  } catch (e) {
    if (!isQuotaError(e)) return 'error'
    evictHalf(key)
    try {
      setRaw(key, payload)
      return 'ok'
    } catch {
      return 'error'
    }
  }
}

export function removeLocal(key: string): void {
  const s = store()
  if (!s) {
    memory.delete(key)
    return
  }
  try {
    s.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function clearAllLocal(): void {
  for (const key of listLocalKeys()) removeLocal(key)
}

/** Approximate bytes used by our own keys, for the Settings page. */
export function localUsageBytes(): number {
  let total = 0
  for (const key of listLocalKeys()) total += key.length + (getRaw(key)?.length ?? 0)
  return total
}
