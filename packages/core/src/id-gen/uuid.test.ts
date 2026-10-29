import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { mulberry32, type RandomSource } from '../random/random.ts'
import { DEFAULT_OPTIONS, generateIds, strength, type IdOptions } from './generate.ts'
import { inspectId } from './inspect.ts'
import {
  MAX_TIMESTAMP_MS,
  UUID_V4_ENTROPY_BITS,
  UUID_V7_ENTROPY_BITS,
  buildUuidV7,
  formatUuid,
  uuidV4,
  uuidV7,
  uuidV7Generator,
} from './uuid.ts'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 2022-02-22T19:22:22.000Z, the instant RFC 9562's Appendix A vectors use. */
const RFC_MS = 0x017f22e279b0

const opts = (over: Partial<IdOptions> = {}): IdOptions => ({
  ...DEFAULT_OPTIONS,
  prefix: '',
  separator: '',
  ...over,
})

const fixed = (ms: number) => () => ms
/** The 12-bit rand_a field of a hyphenated v7, where the counter lives. */
const counter = (id: string) => Number.parseInt(id.slice(15, 18), 16)
const constant = (word: number): RandomSource => () => word

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!, (h) => Number.parseInt(h, 16))
}

describe('UUID v4', () => {
  it('sets version 4 and the RFC 9562 variant on every id', () => {
    const next = mulberry32(1)
    for (let i = 0; i < 500; i++) expect(uuidV4(next)).toMatch(V4)
  })

  it('keeps the version and variant even when the source is all ones or all zeros', () => {
    expect(uuidV4(constant(0xffffffff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(uuidV4(constant(0))).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('is reproducible from a seeded source', () => {
    expect(uuidV4(mulberry32(7))).toBe(uuidV4(mulberry32(7)))
    expect(uuidV4(mulberry32(7))).not.toBe(uuidV4(mulberry32(8)))
  })

  it('does not throw on a large batch (the chunked crypto source)', () => {
    const r = generateIds(opts({ format: 'uuid-v4', count: 1000 }))
    expect(r.ids).toHaveLength(1000)
    expect(new Set(r.ids).size).toBe(1000)
  })
})

describe('UUID v7', () => {
  it('matches the RFC 9562 Appendix A.6 test vector', () => {
    const bytes = buildUuidV7(RFC_MS, 0xcc3, hexBytes('18c4dc0c0c07398f'))
    expect(formatUuid(bytes)).toBe('017f22e2-79b0-7cc3-98c4-dc0c0c07398f')
  })

  it('sets version 7 and the RFC 9562 variant on every id', () => {
    const r = generateIds(opts({ format: 'uuid-v7', count: 1000 }), mulberry32(3))
    for (const id of r.ids) expect(id).toMatch(V7)
  })

  it('encodes the timestamp big-endian in the first 48 bits', () => {
    const id = uuidV7({ source: mulberry32(1), now: fixed(RFC_MS) })
    expect(id.slice(0, 13)).toBe('017f22e2-79b0')
    expect(inspectId(id)?.time?.iso).toBe('2022-02-22T19:22:22.000Z')
  })

  it('handles the full 48-bit range and rejects anything outside it', () => {
    expect(uuidV7({ now: fixed(0) }).slice(0, 13)).toBe('00000000-0000')
    expect(uuidV7({ now: fixed(MAX_TIMESTAMP_MS) }).slice(0, 13)).toBe('ffffffff-ffff')
    expect(() => uuidV7({ now: fixed(MAX_TIMESTAMP_MS + 1) })).toThrow(RangeError)
    expect(() => uuidV7({ now: fixed(-1) })).toThrow(RangeError)
    expect(() => uuidV7({ now: fixed(Number.NaN) })).toThrow(RangeError)
  })

  it('floors a fractional clock reading (performance.now style)', () => {
    expect(uuidV7({ now: fixed(RFC_MS + 0.9) }).slice(0, 13)).toBe('017f22e2-79b0')
  })

  it('sorts a same-millisecond batch in generation order', () => {
    for (const seed of [1, 2, 3, 99]) {
      const { ids } = generateIds(opts({ format: 'uuid-v7', count: 1000 }), mulberry32(seed), fixed(RFC_MS))
      expect(ids).toHaveLength(1000)
      expect(ids.toSorted()).toEqual(ids)
      expect(new Set(ids).size).toBe(1000)
    }
  })

  it('increments the 12-bit counter in rand_a within a millisecond', () => {
    const gen = uuidV7Generator({ source: mulberry32(5), now: fixed(RFC_MS) })
    const a = formatUuid(gen())
    const b = formatUuid(gen())
    expect(counter(b)).toBe(counter(a) + 1)
    // The seed leaves the top counter bit clear: a guard against early rollover.
    expect(counter(a)).toBeLessThan(0x800)
  })

  it('advances the timestamp by 1 ms when the counter overflows', () => {
    // An all-ones source seeds the counter at 0x7ff, its highest guarded value.
    const gen = uuidV7Generator({ source: constant(0xffffffff), now: fixed(RFC_MS) })
    const ids = Array.from({ length: 0x1000 - 0x7ff + 1 }, () => formatUuid(gen()))
    const last = ids.at(-1)!
    const beforeLast = ids.at(-2)!
    expect(beforeLast.slice(0, 13)).toBe('017f22e2-79b0')
    expect(beforeLast.slice(15, 18)).toBe('fff')
    expect(last.slice(0, 13)).toBe('017f22e2-79b1')
    expect(last.slice(15, 18)).toBe('7ff')
    expect(ids.toSorted()).toEqual(ids)
  })

  it('stays monotonic when the clock steps backwards', () => {
    const times = [RFC_MS, RFC_MS - 5, RFC_MS - 5, RFC_MS + 1]
    let i = 0
    const gen = uuidV7Generator({ source: mulberry32(9), now: () => times[i++]! })
    const ids = times.map(() => formatUuid(gen()))
    expect(ids.toSorted()).toEqual(ids)
    expect(ids[1]!.slice(0, 13)).toBe('017f22e2-79b0')
    expect(ids[3]!.slice(0, 13)).toBe('017f22e2-79b1')
  })

  it('stays monotonic across arbitrary non-decreasing clocks', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 2, maxLength: 200 }),
        fc.integer(),
        (steps, seed) => {
          let t = RFC_MS
          const clock = steps.map((s) => (t += s))
          let i = 0
          const gen = uuidV7Generator({ source: mulberry32(seed), now: () => clock[i++]! })
          const ids = clock.map(() => formatUuid(gen()))
          expect(ids.toSorted()).toEqual(ids)
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('UUID formatting options', () => {
  it('uppercases and drops hyphens on request', () => {
    const [id] = generateIds(
      opts({ format: 'uuid-v4', count: 1, letterCase: 'upper', hyphens: false }),
      mulberry32(1),
    ).ids
    expect(id).toMatch(/^[0-9A-F]{12}4[0-9A-F]{3}[89AB][0-9A-F]{15}$/)
  })

  it('canonical and lower are both lowercase for a UUID', () => {
    for (const letterCase of ['canonical', 'lower'] as const) {
      const [id] = generateIds(opts({ format: 'uuid-v7', count: 1, letterCase }), mulberry32(1)).ids
      expect(id).toMatch(V7)
    }
  })

  it('applies a prefix and separator', () => {
    const { ids } = generateIds(opts({ format: 'uuid-v7', prefix: 'user', separator: '_', count: 5 }))
    for (const id of ids) {
      expect(id.startsWith('user_')).toBe(true)
      expect(id.slice(5)).toMatch(V7)
    }
  })

  it('omits the separator when there is no prefix', () => {
    const [id] = generateIds(opts({ format: 'uuid-v4', prefix: '', separator: '_', count: 1 })).ids
    expect(id).toMatch(V4)
  })
})

describe('UUID entropy', () => {
  it('reports only the random bits', () => {
    const v4 = generateIds(opts({ format: 'uuid-v4' }))
    const v7 = generateIds(opts({ format: 'uuid-v7' }))
    expect(v4.entropyBits).toBe(UUID_V4_ENTROPY_BITS)
    expect(v4.entropyBits).toBe(122)
    expect(v7.entropyBits).toBe(UUID_V7_ENTROPY_BITS)
    expect(v7.entropyBits).toBe(62)
    expect(v4.alphabetSize).toBe(16)
  })

  it('rates v4 strong and v7 weak, and warns that v7 reveals its time', () => {
    const v4 = generateIds(opts({ format: 'uuid-v4' }))
    const v7 = generateIds(opts({ format: 'uuid-v7' }))
    expect(strength(v4.entropyBits).level).toBe('strong')
    expect(strength(v7.entropyBits).level).toBe('weak')
    expect(v4.caveat).toBeUndefined()
    expect(v7.caveat).toMatch(/never as a secret/)
  })

  it('ignores the alphabet and length, which do not apply', () => {
    const r = generateIds(opts({ format: 'uuid-v4', alphabet: 'custom', customAlphabet: '', length: 0 }))
    expect(r.error).toBeUndefined()
    expect(r.ids).toHaveLength(DEFAULT_OPTIONS.count)
  })

  it('still validates the count', () => {
    expect(generateIds(opts({ format: 'uuid-v4', count: 0 })).error).toBe('invalid-count')
    expect(generateIds(opts({ format: 'uuid-v7', count: 1001 })).error).toBe('invalid-count')
  })

  it('reports an out-of-range clock as an error, never a partial batch', () => {
    const r = generateIds(opts({ format: 'uuid-v7' }), undefined, fixed(MAX_TIMESTAMP_MS + 1))
    expect(r.error).toBe('time-out-of-range')
    expect(r.ids).toEqual([])
  })
})
