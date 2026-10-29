import {
  civilFromDays,
  daysFromCivil,
  fieldsOf,
  formatOffset,
  isValidTimeZone,
  MS_PER_DAY,
  offsetSeconds,
  utcMs,
  wallTime,
  wallToInstant,
  type WallTime,
} from '../timestamp/zone.ts'
import { MONTH_NAMES, WEEKDAY_NAMES, type CronField, type CronSchedule, type FieldName } from './parse.ts'

/**
 * How a run relates to the zone's daylight-saving changes.
 *
 * - `exact`: the wall time exists once.
 * - `gap`: the wall time was skipped when clocks went forward; the run is moved
 *   to the first instant after the gap.
 * - `overlap-first`: the wall time happens twice because clocks went back; this
 *   is the first occurrence.
 * - `overlap-repeat`: the second occurrence, which cron only runs for
 *   schedules with `*` in the minute or hour field.
 */
export type CronRunKind = 'exact' | 'gap' | 'overlap-first' | 'overlap-repeat'

export interface CronRun {
  /** Epoch milliseconds. */
  ms: number
  /** ISO 8601 with the zone's offset, to the second: `2027-03-14T03:00:00-04:00`. */
  iso: string
  /** UTC offset at the run, in seconds east. */
  offsetSeconds: number
  weekday: string
  kind: CronRunKind
  /** What a DST change did to this run, in plain English; null for an ordinary run. */
  note: string | null
}

export interface NextRunsOptions {
  /** Epoch ms. Runs are strictly after it. */
  now: number
  /** IANA zone the schedule's wall-clock fields are read in. */
  timeZone: string
  /** Default 10. */
  count?: number
  /**
   * Give up after this many years without a run. Default 50: a fixed date on a
   * fixed weekday, Feb 29 included, recurs within 40 years even across a
   * skipped leap year like 2100, so only a schedule that can never fire hits it.
   */
  searchYears?: number
}

export type NextRunsStatus = 'complete' | 'sparse' | 'never'

export type NextRunsResult =
  | {
      ok: true
      runs: CronRun[]
      /** `sparse`: fewer than `count` runs before the search gave up. */
      status: NextRunsStatus
      /** Why there are no (more) runs; null when complete. */
      reason: string | null
      /** DST effects that have no run to hang off, such as runs skipped in a gap. */
      notes: string[]
    }
  | { ok: false; error: { code: 'time-zone' | 'now'; message: string } }

interface WallMatch {
  day: number
  hour: number
  minute: number
  second: number
}

const DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function field(s: CronSchedule, name: FieldName): CronField | undefined {
  return s.fields.find((f) => f.name === name)
}

/** 0 = Sunday, from days since the epoch (a Thursday). */
function weekdayOf(day: number): number {
  return (((day + 4) % 7) + 7) % 7
}

function dayMatches(s: CronSchedule, dom: number, dow: number): boolean {
  const a = s.match.dayOfMonth[dom] === true
  const b = s.match.dayOfWeek[dow] === true
  // Vixie: restrict both and either will do; leave either one as `*` and both must.
  return s.dayOr ? a || b : a && b
}

function firstTime(s: CronSchedule, h0: number, m0: number, s0: number): Omit<WallMatch, 'day'> | null {
  for (let hour = h0; hour < 24; hour++) {
    if (s.match.hour[hour] !== true) continue
    for (let minute = hour === h0 ? m0 : 0; minute < 60; minute++) {
      if (s.match.minute[minute] !== true) continue
      for (let second = hour === h0 && minute === m0 ? s0 : 0; second < 60; second++) {
        if (s.match.second[second] === true) return { hour, minute, second }
      }
    }
  }
  return null
}

/**
 * The first wall-clock time at or after `from` (a UTC-style ms reading of the
 * wall clock) that the schedule matches, searching no later than `lastDay`.
 * Pure calendar arithmetic: no time zone is involved until a match is found.
 */
function nextWallMatch(s: CronSchedule, from: number, lastDay: number): WallMatch | null {
  const start = fieldsOf(from)
  let day = Math.floor(from / MS_PER_DAY)
  let [h0, m0, s0] = [start.hour, start.minute, start.second]
  while (day <= lastDay) {
    const { year, month, day: dom } = civilFromDays(day)
    if (s.match.month[month] !== true) {
      // Skip the rest of the month in one step; month 13 rolls into January.
      day = daysFromCivil(year, month + 1, 1)
      ;[h0, m0, s0] = [0, 0, 0]
      continue
    }
    if (dayMatches(s, dom, weekdayOf(day))) {
      const t = firstTime(s, h0, m0, s0)
      if (t !== null) return { day, ...t }
    }
    day++
    ;[h0, m0, s0] = [0, 0, 0]
  }
  return null
}

/**
 * Why a schedule can never fire, when that can be seen without searching:
 * the day fields must both match and no chosen day of month exists in any
 * chosen month (`0 0 30 2 *`).
 */
export function neverFiresReason(s: CronSchedule): string | null {
  if (s.dayOr) return null
  const doms = field(s, 'dayOfMonth')?.values ?? []
  const months = field(s, 'month')?.values ?? []
  if (months.some((m) => doms.some((d) => d <= (DAYS_IN_MONTH[m] ?? 0)))) return null
  return `Day ${orList(doms.map(String))} never occurs in ${orList(months.map((m) => MONTH_NAMES[m - 1] ?? String(m)))}, so this schedule never fires.`
}

function orList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function isoAt(ms: number, offset: number): string {
  const f = fieldsOf(ms + offset * 1000)
  return `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)}${formatOffset(offset)}`
}

function dateText(day: number): string {
  const { year, month, day: d } = civilFromDays(day)
  return `${year}-${pad(month)}-${pad(d)}`
}

/**
 * The instant clocks jump forward across the gap containing local reading
 * `local`: the first instant after a wall time that doesn't exist. Bisects
 * between the instants the two surrounding offsets would give.
 */
function gapEnd(local: number, timeZone: string): number {
  const before = offsetSeconds(local - MS_PER_DAY, timeZone)
  let lo = local - offsetSeconds(local + MS_PER_DAY, timeZone) * 1000
  let hi = local - before * 1000
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000
    if (offsetSeconds(mid, timeZone) === before) lo = mid
    else hi = mid
  }
  return hi
}

/**
 * The next `count` runs of `s` strictly after `now`, reading the schedule's
 * fields as wall-clock time in `timeZone`.
 *
 * Daylight-saving changes follow Vixie cron, which separates "wildcard" jobs
 * (minute or hour field starting with `*`) from fixed-time ones:
 * - Spring forward: a fixed-time run whose wall time is skipped fires at the
 *   first instant after the gap; wildcard runs in the gap are skipped.
 * - Fall back: a fixed-time run fires once, at the first occurrence; wildcard
 *   runs carry on through the repeated hour, so they fire in both passes.
 */
export function nextRuns(s: CronSchedule, opts: NextRunsOptions): NextRunsResult {
  const { now, timeZone, count = 10, searchYears = 50 } = opts
  if (!isValidTimeZone(timeZone)) {
    return { ok: false, error: { code: 'time-zone', message: `Unknown time zone "${timeZone}".` } }
  }
  if (!Number.isFinite(now)) return { ok: false, error: { code: 'now', message: 'The reference time is not a valid date.' } }

  const impossible = neverFiresReason(s)
  if (impossible !== null) return { ok: true, runs: [], status: 'never', reason: impossible, notes: [] }

  const stepMs = s.hasSeconds ? 1000 : 60_000
  const wild = field(s, 'minute')?.star === true || field(s, 'hour')?.star === true
  const capDays = Math.ceil(searchYears * 365.25)

  // Start from the wall clock just after `now`. If clocks fall back within the
  // next day, wall times a little *before* now's reading recur after `now`, so
  // start that much earlier and let the `> now` filter drop what has passed.
  const offsetNow = offsetSeconds(now, timeZone)
  const minOffset = Math.min(offsetNow, offsetSeconds(now + MS_PER_DAY, timeZone))
  const nowWall = utcMs(wallTime(now, timeZone))
  let cursor = Math.floor((nowWall - (offsetNow - minOffset) * 1000) / stepMs) * stepMs
  if (cursor === Math.floor(nowWall / stepMs) * stepMs) cursor += stepMs

  const runs: CronRun[] = []
  const pending: CronRun[] = []
  const skipped = new Map<number, string[]>()
  let last = now
  const emit = (run: CronRun) => {
    // Several gap times collapse onto one instant; cron runs the job once.
    if (run.ms <= last) return
    runs.push(run)
    last = run.ms
  }
  const make = (ms: number, kind: CronRunKind, note: string | null): CronRun => {
    const offset = offsetSeconds(ms, timeZone)
    const f = fieldsOf(ms + offset * 1000)
    return { ms, iso: isoAt(ms, offset), offsetSeconds: offset, weekday: WEEKDAY_NAMES[f.weekday % 7] as string, kind, note }
  }

  let lastDay = Math.floor(cursor / MS_PER_DAY) + capDays
  while (runs.length < count) {
    const m = nextWallMatch(s, cursor, lastDay)
    if (m === null) break
    const local = m.day * MS_PER_DAY + ((m.hour * 60 + m.minute) * 60 + m.second) * 1000
    cursor = local + stepMs
    // Every instant for this reading is at most `local - minOffset`; if even
    // that has passed, skip the Intl work. This only bites near `now`.
    if (local - minOffset * 1000 <= now) continue

    const civil = civilFromDays(m.day)
    const wall: WallTime = { year: civil.year, month: civil.month, day: civil.day, hour: m.hour, minute: m.minute, second: m.second }
    const clock = s.hasSeconds ? `${pad(m.hour)}:${pad(m.minute)}:${pad(m.second)}` : `${pad(m.hour)}:${pad(m.minute)}`
    const date = dateText(m.day)
    const r = wallToInstant(wall, timeZone)
    let primary: CronRun
    if (r.kind === 'exact') {
      primary = make(r.ms, 'exact', null)
    } else if (r.kind === 'ambiguous') {
      primary = make(
        r.ms,
        'overlap-first',
        wild
          ? `${clock} happens twice on ${date} (clocks fall back). This is the first pass; cron runs this schedule in both, because its minute or hour field starts with *.`
          : `${clock} happens twice on ${date} (clocks fall back). Cron runs a fixed-time job once, at the first occurrence.`,
      )
      if (wild) {
        pending.push(make(r.later, 'overlap-repeat', `${clock} again on ${date}, after clocks fall back. Cron repeats runs whose minute or hour field starts with *.`))
      }
    } else if (wild) {
      const list = skipped.get(m.day) ?? []
      list.push(clock)
      skipped.set(m.day, list)
      continue
    } else {
      primary = make(
        gapEnd(local, timeZone),
        'gap',
        `${clock} doesn't exist on ${date} (clocks spring forward), so cron runs it at the first instant after the gap.`,
      )
    }
    while (pending.length > 0 && (pending[0] as CronRun).ms < primary.ms) emit(pending.shift() as CronRun)
    emit(primary)
    lastDay = m.day + capDays
  }
  for (const run of pending) emit(run)
  runs.splice(count)

  const notes = [...skipped].map(([day, clocks]) => {
    const span = clocks.length === 1 ? clocks[0] : `${clocks[0]}–${clocks[clocks.length - 1]}`
    const n = clocks.length === 1 ? 'a run' : `${clocks.length} runs`
    return `Clocks spring forward on ${dateText(day)}, so ${n} at ${span} fall in the gap and are skipped. Cron skips them rather than catching up, because the minute or hour field starts with *.`
  })

  if (runs.length === 0) {
    return { ok: true, runs, status: 'never', reason: `No run in the next ${searchYears} years.`, notes }
  }
  if (runs.length < count) {
    const plural = runs.length === 1 ? 'run' : 'runs'
    return {
      ok: true,
      runs,
      status: 'sparse',
      reason: `Only ${runs.length} ${plural} found: none for ${searchYears} years after the last one.`,
      notes,
    }
  }
  return { ok: true, runs, status: 'complete', reason: null, notes }
}
