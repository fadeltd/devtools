/**
 * Time zone arithmetic on top of Intl.
 *
 * Intl can tell us the wall-clock fields of an instant in a zone, and nothing
 * else: there is no API for "the offset at this instant" or "the instant at
 * this wall time" short of Temporal. Both are derived here from formatToParts.
 */

export const MS_PER_DAY = 86_400_000

/** The ECMAScript Date range: ±100,000,000 days either side of the epoch. */
export const MAX_MS = 8.64e15

export interface WallTime {
  /** Astronomical year: 1 BC is 0, 2 BC is -1. */
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

// Building a DateTimeFormat costs far more than formatting with one, and the
// tool reformats every second while the relative time ticks.
const partsCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone)
  if (f === undefined) {
    // en-US + gregory + era is the one combination whose parts are numeric and
    // unambiguous for every year in range. The iso8601 calendar drops the sign
    // on BC years, and a bare locale default may not be Gregorian at all.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      era: 'short',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    partsCache.set(timeZone, f)
  }
  return f
}

/** True when the engine accepts `timeZone` as an IANA name (or an alias of one). */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone === '') return false
  try {
    partsFormatter(timeZone)
    return true
  } catch {
    return false
  }
}

/**
 * Days since 1970-01-01 for a proleptic-Gregorian date (Hinnant's algorithm).
 * Plain arithmetic rather than Date, so it has no range limit and no 0–99 →
 * 1900s year remapping, and an out-of-range day simply rolls over.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * ((month + 9) % 12) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

export function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const month = mp < 10 ? mp + 3 : mp - 9
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day: doy - Math.floor((153 * mp + 2) / 5) + 1 }
}

/** Epoch ms for a UTC wall time. */
export function utcMs(w: WallTime): number {
  return daysFromCivil(w.year, w.month, w.day) * MS_PER_DAY + ((w.hour * 60 + w.minute) * 60 + w.second) * 1000
}

export interface Fields extends WallTime {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number
}

/** UTC calendar fields of `ms`, to the second. Shift by an offset first for wall time. */
export function fieldsOf(ms: number): Fields {
  const days = Math.floor(ms / MS_PER_DAY)
  const secs = Math.floor((ms - days * MS_PER_DAY) / 1000)
  return {
    ...civilFromDays(days),
    hour: Math.floor(secs / 3600),
    minute: Math.floor((secs % 3600) / 60),
    second: secs % 60,
    // 1970-01-01 was a Thursday.
    weekday: ((((days + 3) % 7) + 7) % 7) + 1,
  }
}

/** The wall-clock fields of `ms` in `timeZone`, to the second. */
export function wallTime(ms: number, timeZone: string): WallTime {
  const w: WallTime = { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
  let bc = false
  for (const p of partsFormatter(timeZone).formatToParts(new Date(ms))) {
    switch (p.type) {
      case 'era':
        bc = p.value.startsWith('B')
        break
      case 'year':
      case 'month':
      case 'day':
      case 'minute':
      case 'second':
        w[p.type] = Number(p.value)
        break
      case 'hour':
        // Some engines still print midnight as 24 under h23.
        w.hour = Number(p.value) % 24
        break
    }
  }
  if (bc) w.year = 1 - w.year
  return w
}

/** UTC offset of `timeZone` at instant `ms`, in whole seconds (east positive). */
export function offsetSeconds(ms: number, timeZone: string): number {
  // Probing a day either side of the range limits would hand Intl an Invalid
  // Date, which throws. The offset out there is local mean time either way.
  ms = Math.min(MAX_MS, Math.max(-MAX_MS, ms))
  const floorToSecond = Math.floor(ms / 1000) * 1000
  return Math.round((utcMs(wallTime(ms, timeZone)) - floorToSecond) / 1000)
}

/** `+05:30`, `-04:00`, or `+05:53:28` for the historical offsets that carry seconds. */
export function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+'
  const abs = Math.abs(seconds)
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0')
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0')
  const ss = abs % 60
  return ss === 0 ? `${sign}${hh}:${mm}` : `${sign}${hh}:${mm}:${String(ss).padStart(2, '0')}`
}

export type WallResolution =
  | { kind: 'exact'; ms: number }
  /** The wall time occurs twice (clocks went back); the earlier instant is used. */
  | { kind: 'ambiguous'; ms: number; later: number }
  /** The wall time never occurs (clocks went forward); it is shifted forward by the gap. */
  | { kind: 'gap'; ms: number }

/**
 * The instant at which `timeZone` shows wall time `w`, resolved the way
 * Temporal's `'compatible'` disambiguation does: earlier of two in an overlap,
 * shifted forward across a gap. Offsets a day either side bracket any
 * transition, so trying both is enough to find every candidate.
 */
export function wallToInstant(w: WallTime, timeZone: string): WallResolution {
  const local = utcMs(w)
  const before = offsetSeconds(local - MS_PER_DAY, timeZone) * 1000
  const after = offsetSeconds(local + MS_PER_DAY, timeZone) * 1000

  const candidates: number[] = []
  for (const offset of before === after ? [before] : [before, after]) {
    const t = local - offset
    if (offsetSeconds(t, timeZone) * 1000 === offset) candidates.push(t)
  }
  candidates.sort((a, b) => a - b)

  const [first, second] = candidates
  if (first === undefined) return { kind: 'gap', ms: local - before }
  if (second === undefined) return { kind: 'exact', ms: first }
  return { kind: 'ambiguous', ms: first, later: second }
}

/**
 * Every IANA zone the engine knows, with `UTC` first. `supportedValuesOf` is
 * missing from older engines, and V8 omits UTC from its list.
 */
export function listTimeZones(): string[] {
  let zones: string[] = []
  try {
    if (typeof Intl.supportedValuesOf === 'function') zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = []
  }
  return ['UTC', ...zones.filter((z) => z !== 'UTC')]
}

/** The host's zone, or UTC when the engine does not report one. */
export function systemTimeZone(): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof tz === 'string' && tz !== '' ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}
