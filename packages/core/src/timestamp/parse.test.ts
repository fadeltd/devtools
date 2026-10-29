import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { describeDetected, detectUnit, MAX_NS, parseTimestamp, type ParseResult } from './parse.ts'

function ok(r: ParseResult) {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`)
  return r.value
}

function err(r: ParseResult) {
  if (r.ok) throw new Error(`expected an error, got ${r.value.ns}`)
  return r.error
}

function unitOf(s: string) {
  const d = ok(parseTimestamp(s)).detected
  return d.kind === 'epoch' ? d.unit : d.kind
}

describe('detectUnit boundaries', () => {
  it.each([
    [1, 's'],
    [11, 's'],
    [12, 'ms'],
    [14, 'ms'],
    [15, 'us'],
    [17, 'us'],
    [18, 'ns'],
    [20, 'ns'],
  ] as const)('%i digits → %s', (digits, unit) => {
    expect(detectUnit(digits)).toBe(unit)
  })

  it('applies the boundaries to real input', () => {
    expect(unitOf('99999999999')).toBe('s')
    expect(unitOf('100000000000')).toBe('ms')
    expect(unitOf('99999999999999')).toBe('ms')
    expect(unitOf('100000000000000')).toBe('us')
    expect(unitOf('99999999999999999')).toBe('us')
    expect(unitOf('100000000000000000')).toBe('ns')
    expect(unitOf('99999999999999999999')).toBe('ns')
  })

  it('ignores the sign and leading zeros when counting digits', () => {
    const d = ok(parseTimestamp('-0001700000000')).detected
    expect(d).toEqual({ kind: 'epoch', unit: 's', auto: true })
  })
})

describe('epoch input', () => {
  it('scales each unit to the same instant', () => {
    const expected = 1_700_000_000_000_000_000n
    expect(ok(parseTimestamp('1700000000')).ns).toBe(expected)
    expect(ok(parseTimestamp('1700000000000')).ns).toBe(expected)
    expect(ok(parseTimestamp('1700000000000000')).ns).toBe(expected)
    expect(ok(parseTimestamp('1700000000000000000')).ns).toBe(expected)
  })

  it('keeps nanosecond precision that a double would lose', () => {
    const v = ok(parseTimestamp('1700000000123456789'))
    expect(v.ns).toBe(1_700_000_000_123_456_789n)
    // The same literal through Number is already wrong.
    expect(BigInt(Number('1700000000123456789'))).not.toBe(1_700_000_000_123_456_789n)
  })

  it('accepts negative values', () => {
    expect(ok(parseTimestamp('-1')).ns).toBe(-1_000_000_000n)
    expect(ok(parseTimestamp('-86400000', { unit: 'ms' })).ns).toBe(-86_400_000_000_000n)
    expect(ok(parseTimestamp('+5')).ns).toBe(5_000_000_000n)
  })

  it('accepts fractional seconds exactly', () => {
    expect(ok(parseTimestamp('1700000000.123')).ns).toBe(1_700_000_000_123_000_000n)
    expect(ok(parseTimestamp('-1.5')).ns).toBe(-1_500_000_000n)
    expect(ok(parseTimestamp('0.000000001')).ns).toBe(1n)
  })

  it('applies the fraction to the detected unit', () => {
    expect(ok(parseTimestamp('1700000000123.5')).ns).toBe(1_700_000_000_123_500_000n)
  })

  it('drops precision below 1 ns, and says so', () => {
    const v = ok(parseTimestamp('1.0000000019'))
    expect(v.ns).toBe(1_000_000_001n)
    expect(v.notes.join(' ')).toMatch(/beyond 1 ns/)
    const n = ok(parseTimestamp('1700000000000000000.7'))
    expect(n.ns).toBe(1_700_000_000_000_000_000n)
    expect(n.notes).toHaveLength(1)
  })

  it('honours a unit override regardless of magnitude', () => {
    const v = ok(parseTimestamp('1700000000', { unit: 'ms' }))
    expect(v.ns).toBe(1_700_000_000_000_000n)
    expect(v.detected).toEqual({ kind: 'epoch', unit: 'ms', auto: false })
    expect(ok(parseTimestamp('5', { unit: 'ns' })).ns).toBe(5n)
    expect(ok(parseTimestamp('5', { unit: 'us' })).ns).toBe(5000n)
  })

  it('ignores surrounding whitespace and digit separators', () => {
    expect(ok(parseTimestamp('  1_700_000_000\n')).ns).toBe(1_700_000_000_000_000_000n)
    expect(ok(parseTimestamp('1,700,000,000')).ns).toBe(1_700_000_000_000_000_000n)
    expect(ok(parseTimestamp('1,700,000,000,000')).detected).toMatchObject({ unit: 'ms' })
  })

  it('rejects separators that are not between digits', () => {
    for (const bad of ['1__0', '_1', '1_', '1.', '.5', '1,,0']) {
      expect(err(parseTimestamp(bad)).code).toBe('invalid')
    }
  })

  it('round-trips any in-range ns value', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -MAX_NS, max: MAX_NS }), (ns) => {
        expect(ok(parseTimestamp(ns.toString(), { unit: 'ns' })).ns).toBe(ns)
      }),
    )
  })
})

describe('range', () => {
  it('accepts the exact Date limits', () => {
    expect(ok(parseTimestamp('8640000000000000', { unit: 'ms' })).ns).toBe(MAX_NS)
    expect(ok(parseTimestamp('-8640000000000000', { unit: 'ms' })).ns).toBe(-MAX_NS)
  })

  it('reports one past the limit as out of range', () => {
    expect(err(parseTimestamp('8640000000000001', { unit: 'ms' })).code).toBe('out-of-range')
    expect(err(parseTimestamp('-8640000000000000000001')).code).toBe('out-of-range')
    expect(err(parseTimestamp('99999999999999999999999999')).code).toBe('out-of-range')
    expect(err(parseTimestamp('+275760-09-13T00:00:00.001Z')).code).toBe('out-of-range')
    expect(err(parseTimestamp('+999999-01-01')).code).toBe('out-of-range')
  })
})

describe('ISO 8601 / RFC 3339', () => {
  it('reads Z, offsets and fractions', () => {
    expect(ok(parseTimestamp('2023-11-14T22:13:20Z')).ns).toBe(1_700_000_000_000_000_000n)
    expect(ok(parseTimestamp('2023-11-15T03:43:20+05:30')).ns).toBe(1_700_000_000_000_000_000n)
    expect(ok(parseTimestamp('2023-11-15T03:43:20+0530')).ns).toBe(1_700_000_000_000_000_000n)
    expect(ok(parseTimestamp('2023-11-14T17:13:20-05')).ns).toBe(1_700_000_000_000_000_000n)
    expect(ok(parseTimestamp('2023-11-14t22:13:20.123456789z')).ns).toBe(1_700_000_000_123_456_789n)
    expect(ok(parseTimestamp('2023-11-14 22:13:20,5Z')).ns).toBe(1_700_000_000_500_000_000n)
    expect(ok(parseTimestamp('2023-11-14T22:13Z')).ns).toBe(1_699_999_980_000_000_000n)
  })

  it('reports the offset it found', () => {
    expect(ok(parseTimestamp('2023-11-15T03:43:20+05:30')).detected).toEqual({ kind: 'iso', offset: '+05:30' })
    expect(ok(parseTimestamp('2023-11-14T22:13:20Z')).detected).toEqual({ kind: 'iso', offset: 'Z' })
  })

  it('treats a date alone as UTC midnight, and says so', () => {
    const v = ok(parseTimestamp('2024-03-10', { timeZone: 'Asia/Tokyo' }))
    expect(v.ns).toBe(BigInt(Date.UTC(2024, 2, 10)) * 1_000_000n)
    expect(v.detected).toEqual({ kind: 'date' })
    expect(v.notes.join(' ')).toMatch(/midnight UTC/)
  })

  it('keeps years 0–99 literal', () => {
    const v = ok(parseTimestamp('0001-01-01T00:00:00Z'))
    expect(v.ns).toBe(-62_135_596_800_000n * 1_000_000n)
  })

  it('reads expanded years', () => {
    expect(ok(parseTimestamp('-000001-01-01')).ns).toBe(BigInt(Date.UTC(-1, 0, 1)) * 1_000_000n)
    expect(err(parseTimestamp('-000000-01-01')).code).toBe('invalid')
  })

  it('reads a time without offset as wall time in the given zone', () => {
    const v = ok(parseTimestamp('2023-07-01T12:00:00', { timeZone: 'America/New_York' }))
    expect(v.ns).toBe(BigInt(Date.UTC(2023, 6, 1, 16)) * 1_000_000n)
    expect(v.detected).toEqual({ kind: 'iso-local', timeZone: 'America/New_York' })
    const utc = ok(parseTimestamp('2023-07-01T12:00:00'))
    expect(utc.ns).toBe(BigInt(Date.UTC(2023, 6, 1, 12)) * 1_000_000n)
  })

  it('moves a wall time in a DST gap forward', () => {
    // 02:30 on 2024-03-10 does not exist in New York; compatible → 03:30 EDT.
    const v = ok(parseTimestamp('2024-03-10T02:30:00', { timeZone: 'America/New_York' }))
    expect(v.ns).toBe(BigInt(Date.UTC(2024, 2, 10, 7, 30)) * 1_000_000n)
    expect(v.notes.join(' ')).toMatch(/never occurs/)
  })

  it('picks the earlier instant for an ambiguous wall time', () => {
    // 01:30 on 2024-11-03 happens in EDT then again in EST.
    const v = ok(parseTimestamp('2024-11-03T01:30:00', { timeZone: 'America/New_York' }))
    expect(v.ns).toBe(BigInt(Date.UTC(2024, 10, 3, 5, 30)) * 1_000_000n)
    expect(v.notes.join(' ')).toMatch(/occurs twice/)
  })

  it('points at the bad field', () => {
    const month = err(parseTimestamp('2024-13-01'))
    expect(month).toMatchObject({ code: 'invalid', position: 5 })
    expect(err(parseTimestamp('2023-02-29')).position).toBe(8)
    expect(err(parseTimestamp('  2024-01-01T24:00:00Z')).position).toBe(13)
    expect(err(parseTimestamp('2024-01-01T10:60:00Z')).position).toBe(14)
    expect(err(parseTimestamp('2024-01-01T10:00:60Z')).message).toMatch(/Leap second/)
    expect(err(parseTimestamp('2024-01-01T10:00:00+24:00')).position).toBe(19)
  })

  it('accepts 29 February in a leap year only', () => {
    expect(parseTimestamp('2024-02-29').ok).toBe(true)
    expect(parseTimestamp('2000-02-29').ok).toBe(true)
    expect(parseTimestamp('1900-02-29').ok).toBe(false)
  })

  it('reports an unknown zone for offset-less input', () => {
    expect(err(parseTimestamp('2024-01-01T00:00:00', { timeZone: 'Mars/Olympus' })).code).toBe('time-zone')
  })
})

describe('fallbacks and errors', () => {
  it('falls back to Date.parse and flags it as loose', () => {
    const v = ok(parseTimestamp('Tue, 14 Nov 2023 22:13:20 GMT'))
    expect(v.ns).toBe(1_700_000_000_000_000_000n)
    expect(v.detected).toEqual({ kind: 'loose' })
    expect(v.notes.join(' ')).toMatch(/implementation-defined/)
  })

  it('reports empty input distinctly', () => {
    expect(err(parseTimestamp('   ')).code).toBe('empty')
  })

  it('reports garbage as invalid without throwing', () => {
    for (const bad of ['hello', '12:00', '2024-1-1T', 'NaN', '1e12', '0x10']) {
      const r = parseTimestamp(bad)
      expect(r.ok, bad).toBe(false)
    }
  })

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        parseTimestamp(s)
      }),
    )
  })
})

describe('describeDetected', () => {
  it('names the unit and whether it was inferred', () => {
    expect(describeDetected({ kind: 'epoch', unit: 'ms', auto: true })).toBe('Detected: milliseconds')
    expect(describeDetected({ kind: 'epoch', unit: 'us', auto: false })).toBe('Unit: microseconds')
    expect(describeDetected({ kind: 'date' })).toMatch(/UTC midnight/)
    expect(describeDetected({ kind: 'loose' })).toMatch(/Loose/)
  })
})
