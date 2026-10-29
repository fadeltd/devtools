import { NS_PER_MS, parseTimestamp, type ParseError, type ParseOptions, type ParsedTimestamp } from './parse.ts'
import {
  daysFromCivil,
  fieldsOf,
  formatOffset,
  isValidTimeZone,
  MS_PER_DAY,
  offsetSeconds,
  type Fields,
} from './zone.ts'

export interface EpochForms {
  s: string
  ms: string
  us: string
  ns: string
}

export interface IsoWeek {
  /** The ISO week-numbering year, which differs from the calendar year around 1 January. */
  year: number
  week: number
  /** 1 = Monday … 7 = Sunday. */
  weekday: number
}

export interface FormattedTimestamp {
  epoch: EpochForms
  /** ISO 8601 in UTC, with as many fractional digits (3, 6 or 9) as the value needs. */
  isoUtc: string
  /** ISO 8601 wall time in `timeZone`, with the zone's real offset at that instant. */
  isoZoned: string
  /** The zone's offset at that instant, e.g. `+05:30`. */
  offset: string
  /** RFC 7231 IMF-fixdate, or null outside years 0000–9999 where it has no form. */
  httpDate: string | null
  /** Locale-formatted date and time in `timeZone`. */
  human: string
  /** English weekday name in `timeZone`. */
  weekday: string
  isoWeek: IsoWeek
  /** `2023-W46-3`. */
  isoWeekString: string
}

export interface FormatOptions {
  timeZone: string
  /** BCP 47 locale for the human-readable and relative forms. Default: the host's. */
  locale?: string
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
const HTTP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const HTTP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q
}

/** `ns / 10^exp` as an exact decimal string, with no trailing fractional zeros. */
function scaled(ns: bigint, exp: number): string {
  if (exp === 0) return ns.toString()
  const sign = ns < 0n ? '-' : ''
  const abs = ns < 0n ? -ns : ns
  const div = 10n ** BigInt(exp)
  const frac = (abs % div).toString().padStart(exp, '0').replace(/0+$/, '')
  return `${sign}${abs / div}${frac === '' ? '' : `.${frac}`}`
}

export function epochForms(ns: bigint): EpochForms {
  return { s: scaled(ns, 9), ms: scaled(ns, 6), us: scaled(ns, 3), ns: scaled(ns, 0) }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** ISO years 0000–9999 are four digits; outside that, ISO's expanded ±YYYYYY. */
function isoYear(y: number): string {
  if (y >= 0 && y <= 9999) return pad(y, 4)
  return `${y < 0 ? '-' : '+'}${pad(Math.abs(y), 6)}`
}

/**
 * Sub-second digits in groups of three, never fewer than three: that matches
 * `toISOString` for ordinary ms values and keeps µs and ns input lossless.
 */
function fraction(subSecondNs: number): string {
  const nine = pad(subSecondNs, 9)
  if (subSecondNs % 1_000_000 === 0) return nine.slice(0, 3)
  if (subSecondNs % 1000 === 0) return nine.slice(0, 6)
  return nine
}

interface Split {
  /** Floor of the instant to whole ms, safe as a Number within the Date range. */
  ms: number
  /** Nanoseconds past the start of the second, 0–999,999,999. */
  subSecondNs: number
}

function split(ns: bigint): Split {
  const ms = floorDiv(ns, NS_PER_MS)
  const secondStart = floorDiv(ns, 1_000_000_000n) * 1_000_000_000n
  return { ms: Number(ms), subSecondNs: Number(ns - secondStart) }
}

function iso(f: Fields, subSecondNs: number): string {
  return (
    `${isoYear(f.year)}-${pad(f.month)}-${pad(f.day)}` +
    `T${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)}.${fraction(subSecondNs)}`
  )
}

export function isoWeekOf(year: number, month: number, day: number): IsoWeek {
  const days = daysFromCivil(year, month, day)
  const { weekday } = fieldsOf(days * MS_PER_DAY)
  // A week belongs to the year that holds its Thursday.
  const thursday = days + (4 - weekday)
  const weekYear = fieldsOf(thursday * MS_PER_DAY).year
  return { year: weekYear, week: 1 + Math.floor((thursday - daysFromCivil(weekYear, 1, 1)) / 7), weekday }
}

function httpDate(f: Fields): string | null {
  if (f.year < 0 || f.year > 9999) return null
  return (
    `${HTTP_DAYS[f.weekday - 1]}, ${pad(f.day)} ${HTTP_MONTHS[f.month - 1]} ${pad(f.year, 4)} ` +
    `${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)} GMT`
  )
}

const humanCache = new Map<string, Intl.DateTimeFormat>()

function humanFormatter(timeZone: string, locale: string | undefined): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${timeZone}`
  let f = humanCache.get(key)
  if (f === undefined) {
    f = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long', timeZone })
    humanCache.set(key, f)
  }
  return f
}

/**
 * Every rendering of one instant. The caller has already validated `timeZone`
 * (formatTimestamp and convertTimestamp do); an unknown zone here throws.
 */
export function formatInstant(ns: bigint, opts: FormatOptions): FormattedTimestamp {
  const { ms, subSecondNs } = split(ns)
  const utc = fieldsOf(ms)

  const offsetSec = offsetSeconds(ms, opts.timeZone)
  // Shifting by the offset and reading UTC fields gives the zone's wall time
  // in the proleptic Gregorian calendar, whatever calendar Intl would use, and
  // without Date's range limit at the very edges.
  const wall = fieldsOf(ms + offsetSec * 1000)
  const offset = formatOffset(offsetSec)
  const isoWeek = isoWeekOf(wall.year, wall.month, wall.day)

  return {
    epoch: epochForms(ns),
    isoUtc: `${iso(utc, subSecondNs)}Z`,
    isoZoned: `${iso(wall, subSecondNs)}${offset}`,
    offset,
    httpDate: httpDate(utc),
    human: humanFormatter(opts.timeZone, opts.locale).format(new Date(ms)),
    weekday: WEEKDAYS[isoWeek.weekday - 1] ?? '',
    isoWeek,
    isoWeekString: `${isoYear(isoWeek.year)}-W${pad(isoWeek.week)}-${isoWeek.weekday}`,
  }
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365.2425 * MS_PER_DAY],
  ['month', (365.2425 / 12) * MS_PER_DAY],
  ['week', 7 * MS_PER_DAY],
  ['day', MS_PER_DAY],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1000],
]

const relativeCache = new Map<string, Intl.RelativeTimeFormat>()

/**
 * "3 hours ago", "in 2 weeks": the largest unit with at least one whole step,
 * rounded. Months and years are mean lengths -- this is a reading aid, not
 * calendar arithmetic.
 */
export function relativeTime(ns: bigint, now: number, locale?: string): string {
  const key = locale ?? ''
  let rtf = relativeCache.get(key)
  if (rtf === undefined) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeCache.set(key, rtf)
  }
  const diff = Number(floorDiv(ns, NS_PER_MS)) - now
  const abs = Math.abs(diff)
  for (const [unit, size] of RELATIVE_UNITS) {
    if (abs >= size) return rtf.format(Math.round(diff / size), unit)
  }
  return rtf.format(0, 'second')
}

export type ConvertResult =
  | { ok: true; parsed: ParsedTimestamp; formatted: FormattedTimestamp; relative: string }
  | { ok: false; error: ParseError }

export interface ConvertOptions extends ParseOptions {
  timeZone: string
  /** Epoch ms to measure the relative form from. Injected so results are reproducible. */
  now: number
  locale?: string
}

/** Parse and render in one call. Bad input and unknown zones come back as data. */
export function convertTimestamp(input: string, opts: ConvertOptions): ConvertResult {
  if (!isValidTimeZone(opts.timeZone)) {
    return { ok: false, error: { code: 'time-zone', message: `Unknown time zone “${opts.timeZone}”.` } }
  }
  const parsed = parseTimestamp(input, opts)
  if (!parsed.ok) return parsed
  const fmt: FormatOptions = opts.locale === undefined ? { timeZone: opts.timeZone } : { timeZone: opts.timeZone, locale: opts.locale }
  return {
    ok: true,
    parsed: parsed.value,
    formatted: formatInstant(parsed.value.ns, fmt),
    relative: relativeTime(parsed.value.ns, opts.now, opts.locale),
  }
}
