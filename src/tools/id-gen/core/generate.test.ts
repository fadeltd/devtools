import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { mulberry32 } from '@/lib/random'
import {
  ALPHABETS,
  DEFAULT_OPTIONS,
  MAX_COUNT,
  MAX_LENGTH,
  PRESETS,
  entropyBits,
  generateIds,
  resolveAlphabet,
  strength,
  type IdOptions,
} from './generate'

const opts = (over: Partial<IdOptions> = {}): IdOptions => ({ ...DEFAULT_OPTIONS, ...over })

describe('resolveAlphabet', () => {
  it('returns the named alphabet', () => {
    expect(resolveAlphabet({ alphabet: 'hex', excludeAmbiguous: false })).toBe('0123456789abcdef')
  })

  it('drops ambiguous glyphs when asked', () => {
    const a = resolveAlphabet({ alphabet: 'alphanumeric', excludeAmbiguous: true })
    for (const ch of ['O', '0', 'o', 'I', 'l', '1']) expect(a).not.toContain(ch)
    expect(a).toContain('A')
  })

  it('deduplicates, so a repeated character cannot skew the distribution', () => {
    const a = resolveAlphabet({ alphabet: 'custom', customAlphabet: 'aaabbc', excludeAmbiguous: false })
    expect(a).toBe('abc')
  })

  it('base58 already excludes the confusable glyphs', () => {
    for (const ch of ['0', 'O', 'I', 'l']) expect(ALPHABETS.base58).not.toContain(ch)
  })
})

describe('generateIds', () => {
  it('produces the requested count', () => {
    expect(generateIds(opts({ count: 7 })).ids).toHaveLength(7)
  })

  it('builds the Stripe shape', () => {
    const ids = generateIds(opts({ prefix: 'sk_live', separator: '_', length: 24, count: 1 })).ids
    expect(ids[0]).toMatch(/^sk_live_[A-Za-z0-9]{24}$/)
  })

  it('omits the separator when there is no prefix', () => {
    const ids = generateIds(opts({ prefix: '', separator: '_', length: 8, count: 1 })).ids
    expect(ids[0]).toMatch(/^[A-Za-z0-9]{8}$/)
  })

  it('measures length over the random portion only', () => {
    const ids = generateIds(opts({ prefix: 'cus', separator: '_', length: 10, count: 1 })).ids
    expect(ids[0]?.slice('cus_'.length)).toHaveLength(10)
  })

  it('only ever emits characters from the alphabet', () => {
    const alphabet = resolveAlphabet({ alphabet: 'hex', excludeAmbiguous: false })
    for (const id of generateIds(opts({ prefix: '', separator: '', alphabet: 'hex', count: 50 })).ids) {
      for (const ch of id) expect(alphabet).toContain(ch)
    }
  })

  it('does not repeat itself across a batch', () => {
    const { ids } = generateIds(opts({ count: 200, length: 24 }))
    expect(new Set(ids).size).toBe(200)
  })

  it('is reproducible when given a seeded source', () => {
    const a = generateIds(opts({ count: 5 }), mulberry32(42)).ids
    const b = generateIds(opts({ count: 5 }), mulberry32(42)).ids
    const c = generateIds(opts({ count: 5 }), mulberry32(43)).ids
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('does not throw on a large batch', () => {
    // crypto.getRandomValues throws above 64 KiB per call; the chunked source
    // is what keeps this safe.
    expect(() => generateIds(opts({ count: MAX_COUNT, length: 64 }))).not.toThrow()
  })

  describe('validation', () => {
    it('rejects an empty alphabet rather than producing empty ids', () => {
      const r = generateIds(opts({ alphabet: 'custom', customAlphabet: '' }))
      expect(r.error).toBe('empty-alphabet')
      expect(r.ids).toEqual([])
    })

    it('rejects an alphabet emptied by the ambiguity filter', () => {
      expect(
        generateIds(opts({ alphabet: 'custom', customAlphabet: '0O1l', excludeAmbiguous: true }))
          .error,
      ).toBe('empty-alphabet')
    })

    it('rejects out-of-range lengths and counts', () => {
      expect(generateIds(opts({ length: 0 })).error).toBe('invalid-length')
      expect(generateIds(opts({ length: MAX_LENGTH + 1 })).error).toBe('invalid-length')
      expect(generateIds(opts({ length: 1.5 })).error).toBe('invalid-length')
      expect(generateIds(opts({ count: 0 })).error).toBe('invalid-count')
      expect(generateIds(opts({ count: MAX_COUNT + 1 })).error).toBe('invalid-count')
    })
  })
})

describe('entropyBits', () => {
  it('is length times log2(alphabet size)', () => {
    expect(entropyBits(16, 32)).toBe(128) // hex: 4 bits per char
    expect(entropyBits(64, 10)).toBe(60)
  })

  it('is zero for a degenerate alphabet', () => {
    expect(entropyBits(1, 100)).toBe(0)
    expect(entropyBits(62, 0)).toBe(0)
  })

  it('matches the value reported by generateIds', () => {
    const r = generateIds(opts({ alphabet: 'hex', length: 32, prefix: '', separator: '' }))
    expect(r.entropyBits).toBe(128)
    expect(r.alphabetSize).toBe(16)
  })

  it('counts only the random portion — the prefix is public', () => {
    const withPrefix = generateIds(opts({ prefix: 'sk_live', length: 24 }))
    const without = generateIds(opts({ prefix: '', separator: '', length: 24 }))
    expect(withPrefix.entropyBits).toBe(without.entropyBits)
  })
})

describe('strength', () => {
  it('bands entropy sensibly', () => {
    expect(strength(40).level).toBe('weak')
    expect(strength(70).level).toBe('fair')
    expect(strength(128).level).toBe('strong')
    expect(strength(400).level).toBe('excessive')
  })

  it('always explains itself', () => {
    for (const bits of [0, 63, 64, 79, 80, 256, 257, 1000]) {
      expect(strength(bits).detail.length).toBeGreaterThan(10)
    }
  })

  it('rates the Stripe default as strong', () => {
    // 24 alphanumeric characters is ~143 bits.
    expect(strength(generateIds(DEFAULT_OPTIONS).entropyBits).level).toBe('strong')
  })
})

describe('presets', () => {
  it('all produce valid output', () => {
    for (const preset of PRESETS) {
      const r = generateIds(opts(preset.options))
      expect(r.error, preset.name).toBeUndefined()
      expect(r.ids.length, preset.name).toBeGreaterThan(0)
    }
  })

  it('the password preset is strong and avoids confusable glyphs', () => {
    const preset = PRESETS.find((p) => p.name === 'Password')!
    const r = generateIds(opts(preset.options))
    expect(strength(r.entropyBits).level).toBe('strong')
    for (const id of r.ids) {
      for (const ch of ['O', '0', 'l', '1', 'I']) expect(id).not.toContain(ch)
    }
  })
})

describe('properties', () => {
  it('every id has exactly prefix + separator + length characters', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z_]{0,8}$/),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 5 }),
        (prefix, length, count) => {
          const r = generateIds(opts({ prefix, separator: '_', length, count }))
          const head = prefix === '' ? 0 : prefix.length + 1
          for (const id of r.ids) expect(id).toHaveLength(head + length)
        },
      ),
      { numRuns: 150 },
    )
  })

  it('never emits a character outside the resolved alphabet', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('alphanumeric', 'hex', 'base58', 'numeric', 'password'),
        fc.boolean(),
        (alphabet, excludeAmbiguous) => {
          const o = opts({
            alphabet: alphabet as IdOptions['alphabet'],
            excludeAmbiguous,
            prefix: '',
            separator: '',
            count: 5,
            length: 32,
          })
          const allowed = new Set(resolveAlphabet(o))
          for (const id of generateIds(o).ids) {
            for (const ch of id) expect(allowed.has(ch)).toBe(true)
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('distribution is not visibly biased toward the start of the alphabet', () => {
    // A modulo-based implementation skews toward early characters. With 16
    // symbols and 16k draws, every symbol should land near 1/16 of the time.
    const { ids } = generateIds(
      opts({ alphabet: 'hex', prefix: '', separator: '', length: 256, count: 64 }),
    )
    const counts = new Map<string, number>()
    let total = 0
    for (const id of ids) {
      for (const ch of id) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1)
        total++
      }
    }
    const expected = total / 16
    for (const [, n] of counts) {
      expect(Math.abs(n - expected) / expected).toBeLessThan(0.2)
    }
    expect(counts.size).toBe(16)
  })
})
