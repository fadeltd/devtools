/**
 * Unbiased, crypto-backed Fisher-Yates.
 *
 * Two bugs that almost every implementation ships, both fixed here:
 *
 *  1. `crypto.getRandomValues` throws QuotaExceededError above 65,536 BYTES per
 *     call, so a naive `getRandomValues(new Uint32Array(100_000))` crashes
 *     outright. We refill a fixed buffer in chunks instead.
 *  2. `value % n` is biased toward small indices whenever n does not divide
 *     2^32. We use rejection sampling against the largest exact multiple.
 */

/** 16384 u32 = 65,536 bytes, exactly the per-call ceiling. */
const CHUNK_WORDS = 16_384

export type RandomSource = () => number

export function cryptoRandomSource(): RandomSource {
  const buf = new Uint32Array(CHUNK_WORDS)
  let i = buf.length
  return () => {
    if (i >= buf.length) {
      crypto.getRandomValues(buf)
      i = 0
    }
    return buf[i++]!
  }
}

/** Deterministic PRNG, so a shuffle can be reproduced or shared via a seed. */
export function mulberry32(seed: number): RandomSource {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0)
  }
}

/** Uniform integer in [0, n) with no modulo bias. */
export function unbiasedBelow(next: RandomSource, n: number): number {
  if (n <= 1) return 0
  const limit = Math.floor(0x1_0000_0000 / n) * n
  let r = next()
  while (r >= limit) r = next()
  return r % n
}

export function shuffleInPlace<T>(arr: T[], next: RandomSource): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = unbiasedBelow(next, i + 1)
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr
}
