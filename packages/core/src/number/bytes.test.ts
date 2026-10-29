import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatRatio, groupThousands, parseByteSize, type ByteSize } from './bytes.ts'

const size = (input: string): ByteSize => {
  const r = parseByteSize(input)
  if (!r.ok) throw new Error(r.error.message)
  return r
}

describe('parseByteSize', () => {
  it('reads bare bytes', () => {
    expect(size('1536')).toMatchObject({ bytes: 1536n, rounded: false, ambiguous: false, unit: { symbol: 'B' } })
    expect(size('0')).toMatchObject({ bytes: 0n })
    expect(size('12 bytes').bytes).toBe(12n)
    expect(size('1B').bytes).toBe(1n)
  })

  it('reads SI and IEC units, case-insensitively, with or without a space', () => {
    expect(size('1.5 GB').bytes).toBe(1_500_000_000n)
    expect(size('1.5GiB').bytes).toBe(1_610_612_736n)
    expect(size('512 KiB').bytes).toBe(524_288n)
    expect(size('2 TB').bytes).toBe(2_000_000_000_000n)
    expect(size('2 tb').bytes).toBe(2_000_000_000_000n)
    expect(size('1 kib').bytes).toBe(1024n)
    expect(size('1 PiB').bytes).toBe(1024n ** 5n)
    expect(size('3 MB').bytes).toBe(3_000_000n)
  })

  it('reads bare K/M/G as IEC and flags it', () => {
    expect(size('1K')).toMatchObject({ bytes: 1024n, ambiguous: true, unit: { symbol: 'KiB' } })
    expect(size('4 G')).toMatchObject({ bytes: 4n * 1024n ** 3n, ambiguous: true })
    expect(size('1 m').ambiguous).toBe(true)
    expect(size('1 MB').ambiguous).toBe(false)
    expect(size('1 MiB').ambiguous).toBe(false)
  })

  it('rounds a fractional byte count to the nearest byte and says so', () => {
    expect(size('1.5')).toMatchObject({ bytes: 2n, rounded: true })
    expect(size('1.4')).toMatchObject({ bytes: 1n, rounded: true })
    expect(size('0.001 KiB')).toMatchObject({ bytes: 1n, rounded: true })
    expect(size('1.5 KiB')).toMatchObject({ bytes: 1536n, rounded: false })
    expect(size('1.0')).toMatchObject({ bytes: 1n, rounded: false })
  })

  it('accepts number spellings people paste', () => {
    expect(size('1,536').bytes).toBe(1536n)
    expect(size('1,234,567 bytes').bytes).toBe(1_234_567n)
    expect(size('1_000 kB').bytes).toBe(1_000_000n)
    expect(size('.5 KiB').bytes).toBe(512n)
    expect(size('5. MB').bytes).toBe(5_000_000n)
    expect(size('+1 kB').bytes).toBe(1000n)
  })

  it('keeps precision for huge sizes', () => {
    expect(size('123456789012345678901234567890 PiB').bytes).toBe(123456789012345678901234567890n * 1024n ** 5n)
  })

  it('rejects negatives', () => {
    expect(parseByteSize('-1 GB')).toMatchObject({ ok: false, error: { code: 'negative', index: 0 } })
    expect(parseByteSize('  -5')).toMatchObject({ ok: false, error: { code: 'negative', index: 2 } })
  })

  it('rejects unknown units with the unit’s index', () => {
    expect(parseByteSize('1.5 XB')).toMatchObject({ ok: false, error: { code: 'unknown-unit', index: 4 } })
    expect(parseByteSize('1 EB')).toMatchObject({ ok: false, error: { code: 'unknown-unit' } })
    expect(parseByteSize('1 Gb/s')).toMatchObject({ ok: false, error: { code: 'invalid-unit', index: 4, char: '/' } })
    expect(parseByteSize('1 G B')).toMatchObject({ ok: false, error: { code: 'invalid-unit', index: 3 } })
  })

  it('rejects malformed numbers', () => {
    expect(parseByteSize('')).toMatchObject({ ok: false, error: { code: 'empty' } })
    expect(parseByteSize('GB')).toMatchObject({ ok: false, error: { code: 'invalid-number', index: 0, char: 'G' } })
    expect(parseByteSize('1.2.3')).toMatchObject({ ok: false, error: { index: 3 } })
    // "1,5" is a decimal comma or a typo; either way, not 15.
    expect(parseByteSize('1,5 GB')).toMatchObject({ ok: false, error: { code: 'invalid-number', index: 1 } })
    expect(parseByteSize('.')).toMatchObject({ ok: false, error: { code: 'invalid-number' } })
  })
})

describe('scaled outputs', () => {
  it('shows every SI and IEC unit', () => {
    const r = size('1.5 GiB')
    expect(r.si.map((s) => s.unit)).toEqual(['kB', 'MB', 'GB', 'TB', 'PB'])
    expect(r.iec.map((s) => s.unit)).toEqual(['KiB', 'MiB', 'GiB', 'TiB', 'PiB'])
    expect(r.iec[2]).toEqual({ unit: 'GiB', value: '1.5', exact: true })
    expect(r.iec[0]).toEqual({ unit: 'KiB', value: '1572864', exact: true })
    expect(r.si[2]).toEqual({ unit: 'GB', value: '1.611', exact: false })
  })

  it('picks a human-readable headline in each system', () => {
    expect(size('1.5 GiB')).toMatchObject({ humanIec: '1.5 GiB', humanSi: '1.611 GB' })
    expect(size('999')).toMatchObject({ humanIec: '999 B', humanSi: '999 B' })
    expect(size('1000')).toMatchObject({ humanIec: '1000 B', humanSi: '1 kB' })
  })

  it('reports the GB vs GiB gap at the input’s scale', () => {
    expect(size('1 GB').gap).toEqual({ si: 'GB', iec: 'GiB', percent: '7.37' })
    expect(size('1 KiB').gap).toEqual({ si: 'kB', iec: 'KiB', percent: '2.40' })
    expect(size('1 PB').gap.percent).toBe('12.59')
    expect(size('5').gap.iec).toBe('KiB')
    expect(size('5000000').gap.iec).toBe('MiB')
  })
})

describe('formatRatio', () => {
  it('uses 3 decimals at or above 1', () => {
    expect(formatRatio(1536n, 1000n)).toEqual({ value: '1.536', exact: true })
    expect(formatRatio(15365n, 10000n)).toEqual({ value: '1.537', exact: false })
    expect(formatRatio(2000n, 1000n)).toEqual({ value: '2', exact: true })
  })

  it('uses 3 significant digits below 1', () => {
    expect(formatRatio(1n, 1000n)).toEqual({ value: '0.001', exact: true })
    expect(formatRatio(1536n, 10n ** 15n)).toEqual({ value: '0.00000000000154', exact: false })
  })

  it('rounds up into the next integer', () => {
    expect(formatRatio(19999n, 10000n)).toEqual({ value: '2', exact: false })
  })

  it('collapses the vanishingly small to an inexact 0', () => {
    expect(formatRatio(1n, 10n ** 30n)).toEqual({ value: '0', exact: false })
  })

  it('stays within half a unit in the third decimal at or above 1', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 1n << 60n }), fc.bigInt({ min: 1n, max: 1n << 40n }), (d, k) => {
        const n = d + ((k * d) >> 20n)
        const { value, exact } = formatRatio(n, d)
        const [int = '', frac = ''] = value.split('.')
        const shown = BigInt(int + frac.padEnd(3, '0'))
        // |shown/1000 - n/d| <= 1/2000, cross-multiplied to stay exact.
        const diff = shown * d - n * 1000n
        expect((diff < 0n ? -diff : diff) * 2n <= d).toBe(true)
        expect(exact).toBe(diff === 0n)
      }),
    )
  })
})

describe('groupThousands', () => {
  it('inserts commas', () => {
    expect(groupThousands(1610612736n)).toBe('1,610,612,736')
    expect(groupThousands(999n)).toBe('999')
  })
})
