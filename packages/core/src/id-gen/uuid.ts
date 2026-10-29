import { cryptoRandomSource, type RandomSource } from '../random/random.ts'

/**
 * UUID v4 and v7, per RFC 9562.
 *
 * Both draw their random bits through a `RandomSource` rather than calling
 * `crypto.randomUUID`, which cannot be seeded, so tests can inject `mulberry32`
 * and get the same ids every run.
 */

/** Largest timestamp a 48-bit field holds: 2^48 - 1 ms, in the year 10889. */
export const MAX_TIMESTAMP_MS = 0xffff_ffff_ffff

export interface UuidFormat {
  /** Default false: RFC 9562 canonical form is lowercase. */
  uppercase?: boolean
  /** Default true: the 8-4-4-4-12 grouping. */
  hyphens?: boolean
}

/** Read the clock as whole ms, rejecting anything a 48-bit field cannot hold. */
export function readClock(now: () => number): number {
  const ms = Math.floor(now())
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIMESTAMP_MS) {
    throw new RangeError(`Timestamp out of the 48-bit range: ${ms}`)
  }
  return ms
}

/** Fill `n` bytes from a u32 source, four bytes per draw. No bias: every byte of a u32 is uniform. */
export function randomBytes(next: RandomSource, n: number): Uint8Array {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i += 4) {
    const word = next() >>> 0
    for (let b = 0; b < 4 && i + b < n; b++) out[i + b] = (word >>> (24 - 8 * b)) & 0xff
  }
  return out
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function formatUuid(bytes: Uint8Array, format: UuidFormat = {}): string {
  if (bytes.length !== 16) throw new RangeError(`A UUID is 16 bytes, got ${bytes.length}`)
  let hex = ''
  for (const b of bytes) hex += HEX[b]
  if (format.hyphens !== false) {
    hex = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return format.uppercase === true ? hex.toUpperCase() : hex
}

/** Stamp the version nibble (byte 6, high half) and the `10` variant (byte 8, top two bits). */
function stamp(bytes: Uint8Array, version: number): Uint8Array {
  bytes[6] = (bytes[6]! & 0x0f) | (version << 4)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return bytes
}

/** 122 random bits; the other 6 are the version and variant. */
export function uuidV4Bytes(source: RandomSource = cryptoRandomSource()): Uint8Array {
  return stamp(randomBytes(source, 16), 4)
}

export function uuidV4(source?: RandomSource, format?: UuidFormat): string {
  return formatUuid(uuidV4Bytes(source), format)
}

/**
 * Assemble a v7 from its fields (RFC 9562 §5.7):
 * `unix_ts_ms` (48, big-endian) · `ver` (4) · `rand_a` (12) · `var` (2) · `rand_b` (62).
 *
 * `randB` is 8 bytes; its top two bits are overwritten by the variant.
 */
export function buildUuidV7(ms: number, randA: number, randB: Uint8Array): Uint8Array {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIMESTAMP_MS) {
    throw new RangeError(`UUID v7 timestamp out of range: ${ms}`)
  }
  if (randB.length !== 8) throw new RangeError('rand_b must be 8 bytes')
  const out = new Uint8Array(16)
  // 48 bits do not fit a 32-bit shift, so split into a 16-bit high and 32-bit low half.
  const hi = Math.floor(ms / 0x1_0000_0000)
  const lo = ms >>> 0
  out[0] = (hi >>> 8) & 0xff
  out[1] = hi & 0xff
  out[2] = (lo >>> 24) & 0xff
  out[3] = (lo >>> 16) & 0xff
  out[4] = (lo >>> 8) & 0xff
  out[5] = lo & 0xff
  out[6] = (randA >>> 8) & 0x0f
  out[7] = randA & 0xff
  out.set(randB, 8)
  return stamp(out, 7)
}

export interface TimeOrderedOptions {
  source?: RandomSource
  /** Injectable clock, in ms since the epoch. Default `Date.now`. */
  now?: () => number
}

/** Counter seeds use 11 of the 12 bits: the top bit is a rollover guard (RFC 9562 §6.2). */
const COUNTER_MAX = 0xfff
const COUNTER_SEED_MASK = 0x7ff

/**
 * A stateful v7 generator with the RFC 9562 §6.2 method 1 monotonic counter.
 *
 * `rand_a` holds a 12-bit counter, seeded randomly (with a zero guard bit, so
 * at least 2,048 ids fit in one ms) whenever the millisecond changes, and
 * incremented otherwise. When it would overflow, the timestamp advances by
 * 1 ms and the counter is reseeded. A clock that steps backwards is treated as
 * the same millisecond. Together these mean every id sorts after the previous
 * one, so a bulk batch keeps its generation order.
 *
 * `rand_b` is fresh for every id; it is the only part that counts as entropy.
 */
export function uuidV7Generator(options: TimeOrderedOptions = {}): () => Uint8Array {
  const next = options.source ?? cryptoRandomSource()
  const now = options.now ?? Date.now
  // Below any valid reading, so the first call always seeds.
  let lastMs = Number.NEGATIVE_INFINITY
  let counter = 0

  return () => {
    const ms = readClock(now)
    if (ms > lastMs) {
      lastMs = ms
      counter = next() & COUNTER_SEED_MASK
    } else if (counter < COUNTER_MAX) {
      counter++
    } else {
      lastMs++
      counter = next() & COUNTER_SEED_MASK
    }
    return buildUuidV7(lastMs, counter, randomBytes(next, 8))
  }
}

export function uuidV7(options?: TimeOrderedOptions, format?: UuidFormat): string {
  return formatUuid(uuidV7Generator(options)(), format)
}

/** Random bits per id, not counting fixed version/variant bits, timestamps or counters. */
export const UUID_V4_ENTROPY_BITS = 122
export const UUID_V7_ENTROPY_BITS = 62
