import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { convertTimestamp, epochForms, formatInstant, isoWeekOf, relativeTime } from './format.ts'
import { MAX_NS } from './parse.ts'
import {
  civilFromDays,
  daysFromCivil,
  fieldsOf,
  formatOffset,
  listTimeZones,
  offsetSeconds,
  systemTimeZone,
} from './zone.ts'

const NS = 1_000_000n
const T = 1_700_000_000_000_000_000n // 2023-11-14T22:13:20Z, a Tuesday
const at = (iso: string) => BigInt(Date.parse(iso)) * NS

describe('epochForms', () => {
  it('renders every unit exactly', () => {
    expect(epochForms(T)).toEqual({
      s: '1700000000',
      ms: '1700000000000',
      us: '1700000000000000',
      ns: '1700000000000000000',
    })
    expect(epochForms(T + 123_456_789n)).toEqual({
      s: '1700000000.123456789',
      ms: '1700000000123.456789',
      us: '1700000000123456.789',
      ns: '1700000000123456789',
    })
  })

  it('keeps the sign on negative fractions', () => {
    expect(epochForms(-1_500_000_000n).s).toBe('-1.5')
    expect(epochForms(-1n).ms).toBe('-0.000001')
    expect(epochForms(0n).s).toBe('0')
  })
})

describe('formatInstant', () => {
  it('formats UTC forms', () => {
    const f = formatInstant(T, { timeZone: 'UTC', locale: 'en-US' })
    expect(f.isoUtc).toBe('2023-11-14T22:13:20.000Z')
    expect(f.isoZoned).toBe('2023-11-14T22:13:20.000+00:00')
    expect(f.httpDate).toBe('Tue, 14 Nov 2023 22:13:20 GMT')
    expect(f.weekday).toBe('Tuesday')
    expect(f.isoWeekString).toBe('2023-W46-2')
    expect(f.human).toContain('November 14, 2023')
  })

  it('matches toISOString and toUTCString for ms values', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 253402300799999 }), (ms) => {
        const f = formatInstant(BigInt(ms) * NS, { timeZone: 'UTC' })
        expect(f.isoUtc).toBe(new Date(ms).toISOString())
        expect(f.httpDate).toBe(new Date(ms).toUTCString())
      }),
    )
  })

  it('widens the fraction only as far as precision needs', () => {
    expect(formatInstant(T + 1_000n, { timeZone: 'UTC' }).isoUtc).toBe('2023-11-14T22:13:20.000001Z')
    expect(formatInstant(T + 1n, { timeZone: 'UTC' }).isoUtc).toBe('2023-11-14T22:13:20.000000001Z')
  })

  it('floors negative sub-second values into the previous second', () => {
    expect(formatInstant(-1n, { timeZone: 'UTC' }).isoUtc).toBe('1969-12-31T23:59:59.999999999Z')
  })

  it('uses the real half-hour and quarter-hour offsets', () => {
    expect(formatInstant(T, { timeZone: 'Asia/Kolkata' }).isoZoned).toBe('2023-11-15T03:43:20.000+05:30')
    expect(formatInstant(T, { timeZone: 'Asia/Kathmandu' }).offset).toBe('+05:45')
    expect(formatInstant(T, { timeZone: 'America/St_Johns' }).offset).toBe('-03:30')
  })

  it('follows DST: New York in March vs July', () => {
    expect(formatInstant(at('2024-03-01T12:00:00Z'), { timeZone: 'America/New_York' }).isoZoned).toBe(
      '2024-03-01T07:00:00.000-05:00',
    )
    expect(formatInstant(at('2024-07-01T12:00:00Z'), { timeZone: 'America/New_York' }).isoZoned).toBe(
      '2024-07-01T08:00:00.000-04:00',
    )
  })

  it('changes offset exactly at the transition', () => {
    // US spring-forward 2024: 2024-03-10 07:00Z.
    const before = formatInstant(at('2024-03-10T06:59:59Z'), { timeZone: 'America/New_York' })
    const after = formatInstant(at('2024-03-10T07:00:00Z'), { timeZone: 'America/New_York' })
    expect(before.isoZoned).toBe('2024-03-10T01:59:59.000-05:00')
    expect(after.isoZoned).toBe('2024-03-10T03:00:00.000-04:00')
  })

  it('takes weekday and week from the zone, not UTC', () => {
    // 22:13Z Tuesday is already Wednesday in Tokyo.
    const f = formatInstant(T, { timeZone: 'Asia/Tokyo' })
    expect(f.weekday).toBe('Wednesday')
    expect(f.isoWeek).toEqual({ year: 2023, week: 46, weekday: 3 })
  })

  it('handles the edges of the Date range', () => {
    const max = formatInstant(MAX_NS, { timeZone: 'Pacific/Kiritimati' })
    expect(max.isoUtc).toBe('+275760-09-13T00:00:00.000Z')
    expect(max.isoZoned.startsWith('+275760-09-13T')).toBe(true)
    expect(max.httpDate).toBeNull()
    const min = formatInstant(-MAX_NS, { timeZone: 'America/Los_Angeles' })
    expect(min.isoUtc).toBe('-271821-04-20T00:00:00.000Z')
    expect(min.isoZoned.startsWith('-271821-04-19T')).toBe(true)
  })

  it('writes extended years for 0000 and earlier', () => {
    expect(formatInstant(at('0000-01-01T00:00:00Z'), { timeZone: 'UTC' }).isoUtc).toBe('0000-01-01T00:00:00.000Z')
    expect(formatInstant(BigInt(Date.UTC(-1, 0, 1)) * NS, { timeZone: 'UTC' }).isoUtc).toBe(
      '-000001-01-01T00:00:00.000Z',
    )
  })
})

describe('isoWeekOf', () => {
  it.each([
    [2021, 1, 3, { year: 2020, week: 53, weekday: 7 }],
    [2021, 1, 4, { year: 2021, week: 1, weekday: 1 }],
    [2024, 12, 30, { year: 2025, week: 1, weekday: 1 }],
    [2026, 12, 31, { year: 2026, week: 53, weekday: 4 }],
    [2023, 1, 1, { year: 2022, week: 52, weekday: 7 }],
  ])('%i-%i-%i', (y, m, d, expected) => {
    expect(isoWeekOf(y, m, d)).toEqual(expected)
  })
})

describe('relativeTime', () => {
  const now = Date.UTC(2024, 0, 1, 12)
  const rel = (deltaMs: number) => relativeTime(BigInt(now + deltaMs) * NS, now, 'en-US')

  it('chooses the largest whole unit', () => {
    expect(rel(0)).toBe('now')
    expect(rel(-30_000)).toBe('30 seconds ago')
    expect(rel(5 * 60_000)).toBe('in 5 minutes')
    expect(rel(-3 * 3_600_000)).toBe('3 hours ago')
    expect(rel(-86_400_000)).toBe('yesterday')
    expect(rel(2 * 7 * 86_400_000)).toBe('in 2 weeks')
    expect(rel(-90 * 86_400_000)).toBe('3 months ago')
    expect(rel(-5 * 365.25 * 86_400_000)).toBe('5 years ago')
  })

  it('treats sub-second differences as now', () => {
    expect(rel(-400)).toBe('now')
  })
})

describe('convertTimestamp', () => {
  it('parses and renders in one call', () => {
    const r = convertTimestamp('1700000000', { timeZone: 'Asia/Kolkata', now: 1_700_000_060_000, locale: 'en-US' })
    if (!r.ok) throw new Error(r.error.message)
    expect(r.formatted.isoZoned).toBe('2023-11-15T03:43:20.000+05:30')
    expect(r.relative).toBe('1 minute ago')
  })

  it('reports an unknown zone as data', () => {
    const r = convertTimestamp('0', { timeZone: 'Not/AZone', now: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('time-zone')
  })
})

describe('zone helpers', () => {
  it('formats offsets, including LMT seconds', () => {
    expect(formatOffset(0)).toBe('+00:00')
    expect(formatOffset(19800)).toBe('+05:30')
    expect(formatOffset(-12600)).toBe('-03:30')
    expect(formatOffset(21208)).toBe('+05:53:28')
  })

  it('knows a historical offset with seconds', () => {
    expect(offsetSeconds(Date.UTC(1850, 0, 1), 'Asia/Kolkata')).toBe(21208)
  })

  it('lists zones with UTC first and once', () => {
    const zones = listTimeZones()
    expect(zones[0]).toBe('UTC')
    expect(zones.filter((z) => z === 'UTC')).toHaveLength(1)
    expect(zones).toContain('America/New_York')
  })

  it('reports a system zone', () => {
    expect(systemTimeZone()).not.toBe('')
  })

  it('civil date arithmetic round-trips and agrees with Date', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000_000, max: 100_000_000 }), (days) => {
        const c = civilFromDays(days)
        expect(daysFromCivil(c.year, c.month, c.day)).toBe(days)
        const d = new Date(days * 86_400_000)
        expect([c.year, c.month, c.day]).toEqual([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()])
        expect(fieldsOf(days * 86_400_000).weekday).toBe(((d.getUTCDay() + 6) % 7) + 1)
      }),
    )
  })
})
