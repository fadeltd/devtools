import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { mulberry32, type RandomSource } from '../random/random.ts'
import { DEFAULT_OPTIONS, generateIds, strength, type IdOptions } from './generate.ts'
import {
  CROCKFORD,
  ULID_ENTROPY_BITS,
  UlidOverflowError,
  decodeUlidTime,
  encodeUlidTime,
  isUlid,
  ulid,
  ulidGenerator,
} from './ulid.ts'
import { MAX_TIMESTAMP_MS } from './uuid.ts'

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/
const T = 1469918176385

const opts = (over: Partial<IdOptions> = {}): IdOptions => ({
  ...DEFAULT_OPTIONS,
  prefix: '',
  separator: '',
  format: 'ulid',
  ...over,
})

const fixed = (ms: number) => () => ms

/** A source that yields exactly the 80 bits a 16-character random part encodes. */
function sourceFor(random: string): RandomSource {
  let bits = ''
  for (const ch of random) bits += CROCKFORD.indexOf(ch).toString(2).padStart(5, '0')
  bits = bits.padEnd(96, '0')
  const words = [0, 32, 64].map((i) => Number.parseInt(bits.slice(i, i + 32), 2))
  let i = 0
  return () => words[i++ % 3]!
}

describe('Crockford alphabet', () => {
  it('is 32 distinct characters with no I, L, O or U', () => {
    expect(new Set(CROCKFORD).size).toBe(32)
    for (const ch of 'ILOU') expect(CROCKFORD).not.toContain(ch)
  })

  it('never appears outside generated ids', () => {
    for (const id of generateIds(opts({ count: 1000 }), mulberry32(4)).ids) {
      expect(id).toMatch(ULID)
      expect(id).not.toMatch(/[ILOU]/)
    }
  })
})

describe('ULID timestamp', () => {
  it('matches the reference encoding from the ULID spec', () => {
    expect(encodeUlidTime(T)).toBe('01ARYZ6S41')
  })

  it('round-trips every 48-bit timestamp', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_TIMESTAMP_MS }), (ms) => {
        const id = ulid({ now: fixed(ms) })
        expect(id.slice(0, 10)).toBe(encodeUlidTime(ms))
        expect(decodeUlidTime(id)).toBe(ms)
      }),
      { numRuns: 300 },
    )
  })

  it('handles the ends of the range and rejects anything outside it', () => {
    expect(encodeUlidTime(0)).toBe('0000000000')
    expect(encodeUlidTime(MAX_TIMESTAMP_MS)).toBe('7ZZZZZZZZZ')
    expect(() => encodeUlidTime(MAX_TIMESTAMP_MS + 1)).toThrow(RangeError)
    expect(() => encodeUlidTime(-1)).toThrow(RangeError)
    expect(() => encodeUlidTime(1.5)).toThrow(RangeError)
  })

  it('decodes case-insensitively', () => {
    expect(decodeUlidTime('01ARYZ6S41TSV4RRFFQ69G5FAV')).toBe(T)
    expect(decodeUlidTime('01aryz6s41tsv4rrffq69g5fav')).toBe(T)
  })
})

describe('isUlid', () => {
  it('rejects the wrong length, excluded letters and an overflowing first character', () => {
    expect(isUlid('01ARYZ6S41TSV4RRFFQ69G5FA')).toBe(false)
    expect(isUlid('01ARYZ6S41TSV4RRFFQ69G5FAVX')).toBe(false)
    expect(isUlid('01ARYZ6S41TSV4RRFFQ69G5FAI')).toBe(false)
    expect(isUlid('01ARYZ6S41TSV4RRFFQ69G5FAU')).toBe(false)
    expect(isUlid('81ARYZ6S41TSV4RRFFQ69G5FAV')).toBe(false)
    expect(isUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(true)
  })
})

describe('monotonic ULID', () => {
  it('increments the random part by one within a millisecond, carrying (spec example)', () => {
    const gen = ulidGenerator({ source: sourceFor('ACTAV9WEVGEMMVRZ'), now: fixed(T) })
    const a = gen()
    const b = gen()
    expect(a.slice(10)).toBe('ACTAV9WEVGEMMVRZ')
    expect(b.slice(10)).toBe('ACTAV9WEVGEMMVS0')
  })

  it('sorts a same-millisecond batch in generation order', () => {
    for (const seed of [1, 2, 3, 99]) {
      const { ids } = generateIds(opts({ count: 1000 }), mulberry32(seed), fixed(T))
      expect(ids).toHaveLength(1000)
      expect(ids.toSorted()).toEqual(ids)
      expect(new Set(ids).size).toBe(1000)
    }
  })

  it('draws fresh randomness when the millisecond changes', () => {
    let t = T
    const gen = ulidGenerator({ source: mulberry32(2), now: () => t })
    const a = gen()
    t++
    const b = gen()
    expect(b.slice(0, 10)).not.toBe(a.slice(0, 10))
    expect(b > a).toBe(true)
  })

  it('stays monotonic when the clock steps backwards', () => {
    const times = [T, T - 10, T + 1]
    let i = 0
    const gen = ulidGenerator({ source: mulberry32(9), now: () => times[i++]! })
    const ids = times.map(() => gen())
    expect(ids.toSorted()).toEqual(ids)
    expect(decodeUlidTime(ids[1]!)).toBe(T)
  })

  it('reports overflow as an error instead of wrapping', () => {
    const gen = ulidGenerator({ source: () => 0xffffffff, now: fixed(T) })
    const first = gen()
    expect(first.slice(10)).toBe('ZZZZZZZZZZZZZZZZ')
    expect(() => gen()).toThrow(UlidOverflowError)
    // State is untouched by the failed call: it fails again rather than wrapping.
    expect(() => gen()).toThrow(UlidOverflowError)
  })

  it('surfaces overflow from generateIds as an error with no partial batch', () => {
    const r = generateIds(opts({ count: 2 }), () => 0xffffffff, fixed(T))
    expect(r.error).toBe('ulid-overflow')
    expect(r.ids).toEqual([])
  })

  it('can be turned off, giving each id fresh randomness', () => {
    const gen = ulidGenerator({ source: sourceFor('ACTAV9WEVGEMMVRZ'), now: fixed(T), monotonic: false })
    gen()
    // The fixed source repeats, so a non-monotonic second id repeats the random part.
    expect(gen().slice(10)).toBe('ACTAV9WEVGEMMVRZ')
  })
})

describe('ULID through generateIds', () => {
  it('is canonical uppercase by default, lowercase on request', () => {
    // Both calls need the same clock: with the real one, a millisecond tick
    // between them changes the time prefix and the comparison fails.
    const [upper] = generateIds(opts({ count: 1 }), mulberry32(1), fixed(T)).ids
    const [lower] = generateIds(opts({ count: 1, letterCase: 'lower' }), mulberry32(1), fixed(T)).ids
    expect(upper).toMatch(ULID)
    expect(lower).toBe(upper!.toLowerCase())
  })

  it('applies a prefix and separator', () => {
    for (const id of generateIds(opts({ prefix: 'user', separator: '_', count: 5 })).ids) {
      expect(id.startsWith('user_')).toBe(true)
      expect(id.slice(5)).toMatch(ULID)
    }
  })

  it('reports 80 bits and warns that same-ms ids are sequential', () => {
    const r = generateIds(opts())
    expect(r.entropyBits).toBe(ULID_ENTROPY_BITS)
    expect(r.alphabetSize).toBe(32)
    expect(strength(r.entropyBits).level).toBe('strong')
    expect(r.caveat).toMatch(/count up by one/)
  })

  it('reports an out-of-range clock as an error', () => {
    expect(generateIds(opts(), undefined, fixed(-1)).error).toBe('time-out-of-range')
  })
})
