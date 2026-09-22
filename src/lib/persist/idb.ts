import { clear, del, get, keys, set } from 'idb-keyval'
import type { Envelope } from './store'

/**
 * IndexedDB path for tools whose state is measured in megabytes (diff, base64).
 *
 * The key property over localStorage is not just the larger quota: IDB stores
 * structured clones, so a File or Blob goes in as-is -- no base64, no 33%
 * inflation, and no synchronous main-thread serialisation.
 */

const IDB_PREFIX = 'dt:i:'

export function idbKey(slug: string): string {
  return `${IDB_PREFIX}${slug}`
}

export async function readIdb<T>(slug: string, version: number): Promise<T | undefined> {
  try {
    const env = await get<Envelope<T>>(idbKey(slug))
    if (!env || env.v !== version) return undefined
    return env.data
  } catch {
    return undefined
  }
}

export async function writeIdb<T>(slug: string, version: number, data: T): Promise<boolean> {
  try {
    await set(idbKey(slug), { v: version, t: Date.now(), data } satisfies Envelope<T>)
    return true
  } catch {
    return false
  }
}

export async function removeIdb(slug: string): Promise<void> {
  try {
    await del(idbKey(slug))
  } catch {
    /* ignore */
  }
}

export async function clearAllIdb(): Promise<void> {
  try {
    await clear()
  } catch {
    /* ignore */
  }
}

export async function idbKeyCount(): Promise<number> {
  try {
    return (await keys()).length
  } catch {
    return 0
  }
}
