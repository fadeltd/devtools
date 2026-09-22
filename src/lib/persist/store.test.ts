import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as StoreModule from './store'

class FakeStorage implements Storage {
  private map = new Map<string, string>()
  /** Set to a byte budget to make writes throw QuotaExceededError past it. */
  limit = Infinity
  failAlways = false

  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
  setItem(k: string, v: string) {
    if (this.failAlways) throw new DOMException('nope', 'QuotaExceededError')
    const used = [...this.map].reduce(
      (n, [kk, vv]) => (kk === k ? n : n + kk.length + vv.length),
      0,
    )
    if (used + k.length + v.length > this.limit) {
      throw new DOMException('full', 'QuotaExceededError')
    }
    this.map.set(k, v)
  }
}

let fake: FakeStorage
let mod: typeof StoreModule

async function freshModule() {
  fake = new FakeStorage()
  vi.stubGlobal('localStorage', fake)
  vi.resetModules()
  return await import('./store')
}

beforeEach(async () => {
  mod = await freshModule()
})

describe('readLocal / writeLocal', () => {
  it('round-trips a value', () => {
    expect(mod.writeLocal('list', 1, { text: 'hello' })).toBe('ok')
    expect(mod.readLocal('list', 1)).toEqual({ text: 'hello' })
  })

  it('discards state written under a different stateVersion', () => {
    mod.writeLocal('list', 1, { text: 'old shape' })
    expect(mod.readLocal('list', 2)).toBeUndefined()
  })

  it('returns undefined for a missing key and for corrupt JSON', () => {
    expect(mod.readLocal('list', 1)).toBeUndefined()
    fake.setItem(mod.localKey('list'), '{not json')
    expect(mod.readLocal('list', 1)).toBeUndefined()
  })

  it('skips a local write above the cap instead of throwing', () => {
    const big = 'x'.repeat(mod.LOCAL_MAX_BYTES + 1)
    expect(mod.writeLocal('json', 1, { text: big })).toBe('skipped-too-large')
    expect(mod.readLocal('json', 1)).toBeUndefined()
  })
})

describe('quota handling', () => {
  it('evicts the least-recently-used half, then retries', () => {
    // Three stored tools with increasing last-used timestamps.
    vi.setSystemTime(new Date(1000))
    mod.writeLocal('a', 1, { text: 'aaaa' })
    vi.setSystemTime(new Date(2000))
    mod.writeLocal('b', 1, { text: 'bbbb' })
    vi.setSystemTime(new Date(3000))
    mod.writeLocal('c', 1, { text: 'cccc' })

    // Now clamp the budget so the next write must evict to fit.
    fake.limit = mod.localUsageBytes() + 20
    vi.setSystemTime(new Date(4000))
    expect(mod.writeLocal('d', 1, { text: 'dddd' })).toBe('ok')

    expect(mod.readLocal('d', 1)).toEqual({ text: 'dddd' })
    // 'a' was the oldest, so it goes first; 'c' was newest and must survive.
    expect(mod.readLocal('a', 1)).toBeUndefined()
    expect(mod.readLocal('c', 1)).toEqual({ text: 'cccc' })
    vi.useRealTimers()
  })

  it('reports an error rather than throwing when eviction cannot help', () => {
    // A successful write first, so the probe has already decided storage works
    // (otherwise we would transparently fall back to memory and succeed).
    expect(mod.writeLocal('list', 1, { text: 'hi' })).toBe('ok')

    // Now no payload can ever fit, so eviction cannot rescue the write.
    fake.limit = 4
    expect(mod.writeLocal('list', 1, { text: 'hi again' })).toBe('error')
  })

  it('uses memory when the probe itself fails, rather than reporting an error', () => {
    fake.failAlways = true
    // The probe catches this and swaps in the in-memory Map, so the tool keeps
    // working. This is the Safari-private-mode path.
    expect(mod.writeLocal('list', 1, { text: 'hi' })).toBe('ok')
    expect(mod.readLocal('list', 1)).toEqual({ text: 'hi' })
  })
})

describe('unavailable storage', () => {
  it('falls back to memory when localStorage throws on probe', async () => {
    vi.stubGlobal('localStorage', {
      get length(): number {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem() {
        throw new DOMException('denied', 'SecurityError')
      },
      getItem() {
        throw new DOMException('denied', 'SecurityError')
      },
      removeItem() {},
      clear() {},
      key() {
        return null
      },
    } as unknown as Storage)
    vi.resetModules()
    const m = await import('./store')

    // Safari private mode: the probe fails, so we transparently use memory.
    expect(m.writeLocal('list', 1, { text: 'in memory' })).toBe('ok')
    expect(m.readLocal('list', 1)).toEqual({ text: 'in memory' })
  })
})

describe('clearAllLocal', () => {
  it('removes only dt: keys', () => {
    mod.writeLocal('list', 1, { text: 'mine' })
    fake.setItem('unrelated', 'keep me')
    mod.clearAllLocal()
    expect(mod.readLocal('list', 1)).toBeUndefined()
    expect(fake.getItem('unrelated')).toBe('keep me')
  })
})
