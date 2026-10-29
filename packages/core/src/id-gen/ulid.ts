import { cryptoRandomSource } from '../random/random.ts'
import { MAX_TIMESTAMP_MS, randomBytes, readClock, type TimeOrderedOptions } from './uuid.ts'

/**
 * ULID (https://github.com/ulid/spec): a 48-bit ms timestamp as 10 Crockford
 * base32 characters, then 80 random bits as 16 more. 26 characters that sort
 * lexicographically in time order.
 */

/** Crockford base32: digits and letters minus I, L, O and U. */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const DECODE = new Map<string, number>()
for (let i = 0; i < CROCKFORD.length; i++) {
  DECODE.set(CROCKFORD[i]!, i)
  DECODE.set(CROCKFORD[i]!.toLowerCase(), i)
}

export const ULID_LENGTH = 26
export const ULID_ENTROPY_BITS = 80

/**
 * Thrown when a monotonic ULID's random part would pass 2^80 - 1 within one
 * millisecond. The spec requires failing here; wrapping to zero would emit an
 * id that sorts before its predecessor.
 */
export class UlidOverflowError extends Error {
  constructor() {
    super('ULID random component overflowed within one millisecond')
    this.name = 'UlidOverflowError'
  }
}

/** 48-bit ms timestamp to 10 Crockford characters, most significant first. */
export function encodeUlidTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIMESTAMP_MS) {
    throw new RangeError(`ULID timestamp out of range: ${ms}`)
  }
  let out = ''
  let rest = ms
  for (let i = 0; i < 10; i++) {
    // Division, not bit shifts: 48 bits overflow JavaScript's 32-bit operators.
    out = CROCKFORD[rest % 32]! + out
    rest = Math.floor(rest / 32)
  }
  return out
}

/** The timestamp a ULID carries, or null when it is not a valid ULID. */
export function decodeUlidTime(value: string): number | null {
  if (!isUlid(value)) return null
  let ms = 0
  for (let i = 0; i < 10; i++) ms = ms * 32 + DECODE.get(value[i]!)!
  return ms
}

/**
 * 26 Crockford characters, case-insensitive. The first must be 0-7: 26 chars
 * hold 130 bits, and anything higher would encode a timestamp beyond 48 bits.
 */
export function isUlid(value: string): boolean {
  if (value.length !== ULID_LENGTH) return false
  for (const ch of value) if (!DECODE.has(ch)) return false
  return DECODE.get(value[0]!)! <= 7
}

/** 10 bytes (80 bits) to 16 base32 digit values, 5 bits each. */
function bytesToDigits(bytes: Uint8Array): number[] {
  const digits: number[] = []
  let acc = 0
  let bits = 0
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0xfff
    bits += 8
    while (bits >= 5) {
      bits -= 5
      digits.push((acc >>> bits) & 31)
    }
  }
  return digits
}

/**
 * Add one to a base32 digit array in place, carrying left. Returns false when
 * every digit was already 31, i.e. the value overflowed.
 */
function incrementDigits(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i]! < 31) {
      digits[i]!++
      return true
    }
    digits[i] = 0
  }
  return false
}

export interface UlidOptions extends TimeOrderedOptions {
  /**
   * Default true. Within one millisecond, each ULID's random part is the
   * previous one plus 1, so a batch sorts in generation order. Off, every id
   * gets fresh randomness and same-ms ids sort arbitrarily.
   */
  monotonic?: boolean
}

/**
 * A stateful ULID generator. Output is canonical uppercase.
 *
 * Throws `UlidOverflowError` on monotonic overflow (practically unreachable:
 * the seed would have to land within a batch's length of 2^80) and
 * `RangeError` for a timestamp outside 48 bits. A clock that steps backwards
 * is treated as the same millisecond, so ordering survives it.
 */
export function ulidGenerator(options: UlidOptions = {}): () => string {
  const next = options.source ?? cryptoRandomSource()
  const now = options.now ?? Date.now
  const monotonic = options.monotonic !== false
  // Below any valid reading, so the first call always draws fresh randomness.
  let lastMs = Number.NEGATIVE_INFINITY
  let digits: number[] = []

  return () => {
    let ms = readClock(now)
    if (monotonic && ms <= lastMs) {
      ms = lastMs
      // Bump a copy, so a throw leaves the generator's state untouched.
      const bumped = digits.slice()
      if (!incrementDigits(bumped)) throw new UlidOverflowError()
      digits = bumped
    } else {
      digits = bytesToDigits(randomBytes(next, 10))
    }
    const time = encodeUlidTime(ms)
    lastMs = ms
    let rand = ''
    for (const d of digits) rand += CROCKFORD[d]
    return time + rand
  }
}

export function ulid(options?: UlidOptions): string {
  return ulidGenerator(options)()
}
