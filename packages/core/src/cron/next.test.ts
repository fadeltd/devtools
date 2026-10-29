import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { nextRuns, neverFiresReason, type CronRun, type NextRunsOptions, type NextRunsResult } from './next.ts'
import { parseCron, type CronSchedule } from './parse.ts'

function schedule(input: string): CronSchedule {
  const r = parseCron(input)
  if (!r.ok || r.value.kind !== 'schedule') throw new Error(`expected ${input} to parse`)
  return r.value
}

function result(input: string, opts: NextRunsOptions): Extract<NextRunsResult, { ok: true }> {
  const r = nextRuns(schedule(input), opts)
  if (!r.ok) throw new Error(r.error.message)
  return r
}

function runs(input: string, now: string, timeZone: string, count = 10): CronRun[] {
  return result(input, { now: Date.parse(now), timeZone, count }).runs
}

const isos = (input: string, now: string, timeZone: string, count = 10) =>
  runs(input, now, timeZone, count).map((r) => r.iso)

const NY = 'America/New_York'

describe('nextRuns: basics', () => {
  it('lists the next runs strictly after now, in the zone', () => {
    expect(isos('0 9 * * *', '2026-10-30T12:00:00Z', 'UTC', 3)).toEqual([
      '2026-10-31T09:00:00+00:00',
      '2026-11-01T09:00:00+00:00',
      '2026-11-02T09:00:00+00:00',
    ])
    expect(isos('0 9 * * *', '2026-10-30T12:00:00Z', 'Asia/Tokyo', 2)).toEqual([
      '2026-10-31T09:00:00+09:00',
      '2026-11-01T09:00:00+09:00',
    ])
  })

  it('defaults to 10 runs', () => {
    expect(result('* * * * *', { now: 0, timeZone: 'UTC' }).runs).toHaveLength(10)
  })

  it('names the weekday and carries the offset', () => {
    const [run] = runs('0 0 * * *', '2026-10-30T12:00:00Z', 'Asia/Kolkata', 1)
    expect(run).toMatchObject({ weekday: 'Saturday', offsetSeconds: 19800, kind: 'exact', note: null })
  })

  it('handles */15 exactly on a minute boundary', () => {
    expect(isos('*/15 * * * *', '2026-10-30T12:00:00.000Z', 'UTC', 2)).toEqual([
      '2026-10-30T12:15:00+00:00',
      '2026-10-30T12:30:00+00:00',
    ])
    expect(isos('*/15 * * * *', '2026-10-30T12:14:59.999Z', 'UTC', 1)).toEqual(['2026-10-30T12:15:00+00:00'])
    expect(isos('*/15 * * * *', '2026-10-30T12:15:00.000Z', 'UTC', 1)).toEqual(['2026-10-30T12:30:00+00:00'])
    expect(isos('*/15 * * * *', '2026-10-30T12:15:00.001Z', 'UTC', 1)).toEqual(['2026-10-30T12:30:00+00:00'])
  })

  it('rolls over the end of an hour, day, month and year', () => {
    expect(isos('*/20 * * * *', '2026-12-31T23:50:00Z', 'UTC', 2)).toEqual([
      '2027-01-01T00:00:00+00:00',
      '2027-01-01T00:20:00+00:00',
    ])
  })

  it('runs a 6-field schedule to the second', () => {
    expect(isos('*/10 * * * * *', '2026-10-30T12:00:05Z', 'UTC', 3)).toEqual([
      '2026-10-30T12:00:10+00:00',
      '2026-10-30T12:00:20+00:00',
      '2026-10-30T12:00:30+00:00',
    ])
    expect(isos('30 0 0 * * *', '2026-10-30T12:00:00Z', 'UTC', 1)).toEqual(['2026-10-31T00:00:30+00:00'])
    expect(isos('59 59 23 31 12 *', '2026-10-30T12:00:00Z', 'UTC', 1)).toEqual(['2026-12-31T23:59:59+00:00'])
  })

  it('reads day-of-week 7 as Sunday', () => {
    expect(runs('0 0 * * 7', '2026-10-30T12:00:00Z', 'UTC', 3).map((r) => r.weekday)).toEqual([
      'Sunday',
      'Sunday',
      'Sunday',
    ])
  })

  it('refuses an unknown zone as data', () => {
    expect(nextRuns(schedule('* * * * *'), { now: 0, timeZone: 'Mars/Olympus' })).toEqual({
      ok: false,
      error: { code: 'time-zone', message: 'Unknown time zone "Mars/Olympus".' },
    })
  })
})

describe('nextRuns: Vixie day-of-month OR day-of-week', () => {
  it('fires on the 13th and on every Friday when both are restricted', () => {
    const list = runs('0 0 13 * FRI', '2026-01-01T00:00:00Z', 'UTC', 40)
    for (const run of list) expect(run.weekday === 'Friday' || run.iso.slice(8, 10) === '13').toBe(true)
    // Both halves of the OR show up, not just their intersection.
    expect(list.some((r) => r.weekday === 'Friday' && r.iso.slice(8, 10) !== '13')).toBe(true)
    expect(list.some((r) => r.weekday !== 'Friday' && r.iso.slice(8, 10) === '13')).toBe(true)
    expect(isos('0 0 13 * FRI', '2026-01-01T00:00:00Z', 'UTC', 4)).toEqual([
      '2026-01-02T00:00:00+00:00', // Friday
      '2026-01-09T00:00:00+00:00', // Friday
      '2026-01-13T00:00:00+00:00', // Tuesday the 13th
      '2026-01-16T00:00:00+00:00', // Friday
    ])
  })

  it('needs both when day of week is *', () => {
    const list = runs('0 0 13 * *', '2026-01-01T00:00:00Z', 'UTC', 12)
    expect(list.every((r) => r.iso.slice(8, 10) === '13')).toBe(true)
  })

  it('needs both when a day field merely starts with * (*/2)', () => {
    const list = runs('0 0 */2 * FRI', '2026-01-01T00:00:00Z', 'UTC', 20)
    for (const run of list) {
      expect(run.weekday).toBe('Friday')
      expect(Number(run.iso.slice(8, 10)) % 2).toBe(1)
    }
  })
})

describe('nextRuns: daylight saving in America/New_York', () => {
  // 2026: clocks spring forward 2026-03-08 02:00 EST -> 03:00 EDT and fall back
  // 2026-11-01 02:00 EDT -> 01:00 EST.

  it('moves a fixed-time run in the spring gap to the first instant after it', () => {
    const list = runs('30 2 * * *', '2026-03-07T12:00:00-05:00', NY, 3)
    expect(list.map((r) => r.iso)).toEqual([
      '2026-03-08T03:00:00-04:00',
      '2026-03-09T02:30:00-04:00',
      '2026-03-10T02:30:00-04:00',
    ])
    expect(list[0]).toMatchObject({ kind: 'gap' })
    expect(list[0]?.note).toMatch(/02:30 doesn't exist on 2026-03-08.*first instant after the gap/)
  })

  it('collapses several fixed-time runs in the gap into one', () => {
    expect(isos('0,15,30,45 2 * * *', '2026-03-08T01:00:00-05:00', NY, 3)).toEqual([
      '2026-03-08T03:00:00-04:00',
      '2026-03-09T02:00:00-04:00',
      '2026-03-09T02:15:00-04:00',
    ])
  })

  it('skips wildcard runs in the gap, and says so', () => {
    const r = result('30 * * * *', { now: Date.parse('2026-03-08T00:45:00-05:00'), timeZone: NY, count: 3 })
    expect(r.runs.map((x) => x.iso)).toEqual([
      '2026-03-08T01:30:00-05:00',
      '2026-03-08T03:30:00-04:00',
      '2026-03-08T04:30:00-04:00',
    ])
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]).toMatch(/2026-03-08.*a run at 02:30.*skipped/)
  })

  it('runs a fixed-time job once in the autumn overlap, at the first occurrence', () => {
    const list = runs('30 1 * * *', '2026-10-31T12:00:00-04:00', NY, 2)
    expect(list.map((r) => r.iso)).toEqual(['2026-11-01T01:30:00-04:00', '2026-11-02T01:30:00-05:00'])
    expect(list[0]).toMatchObject({ kind: 'overlap-first' })
    expect(list[0]?.note).toMatch(/happens twice on 2026-11-01.*once, at the first occurrence/)
  })

  it('does not rerun a fixed-time job when now is in the second pass', () => {
    expect(isos('45 1 * * *', '2026-11-01T01:10:00-05:00', NY, 1)).toEqual(['2026-11-02T01:45:00-05:00'])
  })

  it('runs a wildcard job through both passes of the repeated hour', () => {
    const list = runs('*/30 1 * * *', '2026-11-01T00:45:00-04:00', NY, 5)
    expect(list.map((r) => r.iso)).toEqual([
      '2026-11-01T01:00:00-04:00',
      '2026-11-01T01:30:00-04:00',
      '2026-11-01T01:00:00-05:00',
      '2026-11-01T01:30:00-05:00',
      '2026-11-02T01:00:00-05:00',
    ])
    expect(list.map((r) => r.kind)).toEqual(['overlap-first', 'overlap-first', 'overlap-repeat', 'overlap-repeat', 'exact'])
  })

  it('catches the repeated hour when now is late in the first pass', () => {
    expect(isos('*/15 * * * *', '2026-11-01T01:50:00-04:00', NY, 6)).toEqual([
      '2026-11-01T01:00:00-05:00',
      '2026-11-01T01:15:00-05:00',
      '2026-11-01T01:30:00-05:00',
      '2026-11-01T01:45:00-05:00',
      '2026-11-01T02:00:00-05:00',
      '2026-11-01T02:15:00-05:00',
    ])
  })

  it('keeps every list strictly increasing across both changes', () => {
    for (const now of ['2026-03-07T23:00:00-05:00', '2026-10-31T23:00:00-04:00']) {
      const list = runs('*/7 * * * *', now, NY, 60)
      for (let i = 1; i < list.length; i++) expect((list[i] as CronRun).ms).toBeGreaterThan((list[i - 1] as CronRun).ms)
    }
  })
})

describe('nextRuns: half-hour zones', () => {
  it('reads wall time in a fixed +05:30 zone', () => {
    expect(isos('30 9 * * *', '2026-10-30T00:00:00Z', 'Asia/Kolkata', 2)).toEqual([
      '2026-10-30T09:30:00+05:30',
      '2026-10-31T09:30:00+05:30',
    ])
  })

  it('handles the spring gap in Adelaide (+09:30 -> +10:30)', () => {
    // 2026-10-04 02:00 ACST -> 03:00 ACDT.
    expect(isos('30 2 * * *', '2026-10-03T12:00:00+09:30', 'Australia/Adelaide', 2)).toEqual([
      '2026-10-04T03:00:00+10:30',
      '2026-10-05T02:30:00+10:30',
    ])
  })

  it('handles a half-hour DST shift on Lord Howe Island (+10:30 -> +11:00)', () => {
    // 2026-10-04 02:00 -> 02:30: only half an hour goes missing.
    expect(isos('15 2 * * *', '2026-10-03T12:00:00+10:30', 'Australia/Lord_Howe', 2)).toEqual([
      '2026-10-04T02:30:00+11:00',
      '2026-10-05T02:15:00+11:00',
    ])
    expect(isos('45 2 * * *', '2026-10-03T12:00:00+10:30', 'Australia/Lord_Howe', 1)).toEqual([
      '2026-10-04T02:45:00+11:00',
    ])
  })
})

describe('nextRuns: rare and impossible schedules', () => {
  it('finds Feb 29 every four years', () => {
    expect(isos('0 0 29 2 *', '2026-10-30T00:00:00Z', 'UTC', 3)).toEqual([
      '2028-02-29T00:00:00+00:00',
      '2032-02-29T00:00:00+00:00',
      '2036-02-29T00:00:00+00:00',
    ])
  })

  it('skips 2100, which is not a leap year', () => {
    expect(isos('0 0 29 2 *', '2097-01-01T00:00:00Z', 'UTC', 1)).toEqual(['2104-02-29T00:00:00+00:00'])
  })

  it('says "never fires" for a date that does not exist, quickly', () => {
    const start = performance.now()
    const r = result('0 0 30 2 *', { now: Date.parse('2026-10-30T00:00:00Z'), timeZone: 'UTC' })
    expect(performance.now() - start).toBeLessThan(50)
    expect(r).toMatchObject({ runs: [], status: 'never' })
    expect(r.reason).toBe('Day 30 never occurs in February, so this schedule never fires.')
    expect(neverFiresReason(schedule('0 0 31 4,6,9,11 *'))).toBe(
      'Day 31 never occurs in April, June, September or November, so this schedule never fires.',
    )
  })

  it('does not call a day-of-week OR schedule impossible', () => {
    expect(neverFiresReason(schedule('0 0 30 2 MON'))).toBeNull()
    expect(runs('0 0 30 2 MON', '2026-10-30T00:00:00Z', 'UTC', 1)[0]?.weekday).toBe('Monday')
  })

  it('stops after the search horizon and says the list is short', () => {
    const r = result('0 0 29 2 *', { now: Date.parse('2026-10-30T00:00:00Z'), timeZone: 'UTC', count: 5, searchYears: 5 })
    expect(r.status).toBe('complete')
    const short = result('0 0 29 2 *', { now: Date.parse('2026-10-30T00:00:00Z'), timeZone: 'UTC', count: 5, searchYears: 1 })
    expect(short).toMatchObject({ runs: [], status: 'never', reason: 'No run in the next 1 years.' })
  })
})

const list = (min: number, max: number) =>
  fc.uniqueArray(fc.integer({ min, max }), { minLength: 1, maxLength: 4 }).map((xs) => xs.join(','))

describe('nextRuns: agrees with a brute-force minute walk (UTC)', () => {
  const expr = fc.tuple(
    fc.oneof(list(0, 59), fc.constantFrom('*', '*/5', '*/7')),
    fc.oneof(list(0, 23), fc.constantFrom('*', '*/3')),
    fc.oneof(list(1, 28), fc.constantFrom('*', '*/2')),
    fc.constant('*'),
    fc.oneof(list(0, 6), fc.constant('*')),
  )

  it('matches minute by minute', () => {
    fc.assert(
      fc.property(expr, fc.integer({ min: 0, max: 4_000_000_000 }), (fields, minutes) => {
        const s = schedule(fields.join(' '))
        const now = minutes * 60_000 + 12_345
        const got = result(fields.join(' '), { now, timeZone: 'UTC', count: 3 }).runs.map((r) => r.ms)

        const want: number[] = []
        const [mins, hours, doms, , dows] = fields.map((f, i) => s.fields[i]?.values ?? [])
        const dayOr = s.dayOr
        for (let t = Math.ceil((now + 1) / 60_000) * 60_000; want.length < 3; t += 60_000) {
          const d = new Date(t)
          const dom = doms?.includes(d.getUTCDate()) === true
          const dow = dows?.includes(d.getUTCDay()) === true
          if (!(dayOr ? dom || dow : dom && dow)) {
            // Jump to the last minute of the day; the loop step lands on midnight.
            t = Math.floor(t / 86_400_000) * 86_400_000 + 86_400_000 - 60_000
            continue
          }
          if (mins?.includes(d.getUTCMinutes()) && hours?.includes(d.getUTCHours())) want.push(t)
        }
        expect(got).toEqual(want)
      }),
      { numRuns: 200 },
    )
  })
})
