import {
  civilFromDays,
  daysFromCivil,
  formatOffset,
  isValidTimeZone,
  MAX_MS,
  utcMs,
  wallToInstant,
  type WallTime,
} from './zone.ts'

export type EpochUnit = 's' | 'ms' | 'us' | 'ns'
export type UnitChoice = 'auto' | EpochUnit

export const UNIT_NAMES: Record<EpochUnit, string> = {
  s: 'seconds',
  ms: 'milliseconds',
  us: 'microseconds',
  ns: 'nanoseconds',
}

/** Digits after the decimal point that each unit holds at nanosecond resolution. */
const UNIT_EXP: Record<EpochUnit, number> = { s: 9, ms: 6, us: 3, ns: 0 }

export const NS_PER_MS = 1_000_000n
/** ±8.64e15 ms, the Date range, in ns. Beyond it there is no calendar to show. */
export const MAX_NS = BigInt(MAX_MS) * NS_PER_MS

export type Detected =
  | { kind: 'epoch'; unit: EpochUnit; auto: boolean }
  | { kind: 'iso'; offset: string }
  /** An ISO date-time with no offset, read as wall time in `timeZone`. */
  | { kind: 'iso-local'; timeZone: string }
  /** Date only: read as UTC midnight, which is what ECMAScript does too. */
  | { kind: 'date' }
  /** Not a format we recognise; `Date.parse` accepted it on its own terms. */
  | { kind: 'loose' }

export interface ParsedTimestamp {
  /** Exact nanoseconds since 1970-01-01T00:00:00Z. */
  ns: bigint
  detected: Detected
  /** Anything the reader should know about how the input was interpreted. */
  notes: string[]
}

export type ParseErrorCode = 'empty' | 'invalid' | 'out-of-range' | 'time-zone'

export interface ParseError {
  code: ParseErrorCode
  message: string
  /** 0-based offset into the original input, when one field is to blame. */
  position?: number
}

export type ParseResult = { ok: true; value: ParsedTimestamp } | { ok: false; error: ParseError }

export interface ParseOptions {
  /** Force the epoch unit instead of inferring it from the digit count. */
  unit?: UnitChoice
  /** Where an ISO date-time without an offset is read as wall time. Default UTC. */
  timeZone?: string
}

/**
 * Unit by digit count, ignoring leading zeros. Up to 11 digits reaches the
 * year 5138 in seconds, while 12 digits in ms only starts in 1973, so the
 * bands barely collide for any timestamp a person is likely to paste.
 */
export function detectUnit(digits: number): EpochUnit {
  if (digits <= 11) return 's'
  if (digits <= 14) return 'ms'
  if (digits <= 17) return 'us'
  return 'ns'
}

// Separators are only allowed between digits, so `1_700` and `1,700,000` pass
// while `_1`, `1__0` and `1.` stay invalid rather than silently meaning something.
const EPOCH_RE = /^([+-]?)(\d+(?:[_,]\d+)*)(?:\.(\d+(?:_\d+)*))?$/

const ISO_RE =
  /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?)?$/

const fail = (code: ParseErrorCode, message: string, position?: number): ParseResult => ({
  ok: false,
  error: position === undefined ? { code, message } : { code, message, position },
})

function inRange(ns: bigint): boolean {
  return ns >= -MAX_NS && ns <= MAX_NS
}

const OUT_OF_RANGE =
  'Out of range: dates can only be shown within ±8.64e15 ms of the epoch (years −271821 to 275760).'

function parseEpoch(m: RegExpExecArray, unitChoice: UnitChoice): ParseResult {
  const negative = m[1] === '-'
  const intDigits = (m[2] ?? '').replace(/[_,]/g, '')
  const fracDigits = (m[3] ?? '').replace(/_/g, '')

  const significant = intDigits.replace(/^0+/, '').length
  const unit = unitChoice === 'auto' ? detectUnit(Math.max(1, significant)) : unitChoice
  const exp = UNIT_EXP[unit]
  const notes: string[] = []

  let frac = fracDigits
  if (frac.length > exp) {
    notes.push(
      exp === 0
        ? 'Nanoseconds are the finest unit: the fractional part was dropped.'
        : `Precision beyond 1 ns was dropped (${frac.length - exp} extra fractional digit${frac.length - exp === 1 ? '' : 's'}).`,
    )
    frac = frac.slice(0, exp)
  }

  const scale = 10n ** BigInt(exp)
  const magnitude = BigInt(intDigits) * scale + (exp === 0 ? 0n : BigInt(frac.padEnd(exp, '0')))
  const ns = negative ? -magnitude : magnitude

  if (!inRange(ns)) return fail('out-of-range', OUT_OF_RANGE)
  return { ok: true, value: { ns, detected: { kind: 'epoch', unit, auto: unitChoice === 'auto' }, notes } }
}

function parseIso(m: RegExpExecArray, lead: number, timeZone: string): ParseResult {
  // Group start positions, for pointing at the field that is wrong. Each
  // field's offset follows from the fixed-width shape the regex enforces.
  const yearLen = (m[1] ?? '').length
  const at = { month: lead + yearLen + 1, day: lead + yearLen + 4, hour: lead + yearLen + 7 }
  const pos = { ...at, minute: at.hour + 3, second: at.hour + 6 }

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hasTime = m[4] !== undefined
  const hour = Number(m[4] ?? 0)
  const minute = Number(m[5] ?? 0)
  const second = Number(m[6] ?? 0)

  if ((m[1] ?? '') === '-000000') return fail('invalid', 'The year −000000 is not allowed; write +000000.', lead)
  if (month < 1 || month > 12) return fail('invalid', `Month ${m[2]} is not between 01 and 12.`, pos.month)
  const wall: WallTime = { year, month, day, hour, minute, second }
  if (day < 1 || civilFromDays(daysFromCivil(year, month, day)).day !== day) {
    return fail('invalid', `Day ${m[3]} does not exist in ${String(year).padStart(4, '0')}-${m[2]}.`, pos.day)
  }
  if (hour > 23) return fail('invalid', `Hour ${m[4]} is not between 00 and 23.`, pos.hour)
  if (minute > 59) return fail('invalid', `Minute ${m[5]} is not between 00 and 59.`, pos.minute)
  if (second === 60) {
    return fail('invalid', 'Leap second :60 cannot be represented: Unix time has no leap seconds.', pos.second)
  }
  if (second > 59) return fail('invalid', `Second ${m[6]} is not between 00 and 59.`, pos.second)

  const notes: string[] = []
  let fracDigits = m[7] ?? ''
  if (fracDigits.length > 9) {
    notes.push(`Precision beyond 1 ns was dropped (${fracDigits.length - 9} extra fractional digits).`)
    fracDigits = fracDigits.slice(0, 9)
  }
  const fracNs = BigInt(fracDigits.padEnd(9, '0') || '0')

  let detected: Detected
  let baseMs: number
  if (!hasTime) {
    detected = { kind: 'date' }
    baseMs = utcMs(wall)
    notes.push('Date only: read as midnight UTC.')
  } else if (m[8] !== undefined) {
    detected = { kind: 'iso', offset: 'Z' }
    baseMs = utcMs(wall)
  } else if (m[9] !== undefined) {
    const oh = Number(m[10])
    const om = Number(m[11] ?? 0)
    const offsetPos = lead + m[0].lastIndexOf(m[9])
    if (oh > 23 || om > 59) return fail('invalid', `Offset ${m[9]}${m[10]}${m[11] === undefined ? '' : `:${m[11]}`} is not a valid UTC offset.`, offsetPos)
    const sign = m[9] === '-' ? -1 : 1
    const offsetSec = sign * (oh * 3600 + om * 60)
    detected = { kind: 'iso', offset: formatOffset(offsetSec) }
    baseMs = utcMs(wall) - offsetSec * 1000
  } else {
    if (!isValidTimeZone(timeZone)) return fail('time-zone', `Unknown time zone “${timeZone}”.`)
    const resolved = wallToInstant(wall, timeZone)
    detected = { kind: 'iso-local', timeZone }
    baseMs = resolved.ms
    notes.push(`No offset given: read as wall-clock time in ${timeZone}.`)
    if (resolved.kind === 'ambiguous') {
      notes.push(`That time occurs twice in ${timeZone} (clocks went back); the earlier one is used.`)
    } else if (resolved.kind === 'gap') {
      notes.push(`That time never occurs in ${timeZone} (clocks went forward); it was moved past the gap.`)
    }
  }

  const ns = BigInt(baseMs) * NS_PER_MS + fracNs
  if (!inRange(ns)) return fail('out-of-range', OUT_OF_RANGE)
  return { ok: true, value: { ns, detected, notes } }
}

/**
 * Parse one timestamp: a Unix epoch number (unit inferred or forced), a strict
 * ISO 8601 / RFC 3339 date or date-time, or, failing both, whatever
 * `Date.parse` makes of it, flagged as such. Never throws.
 */
export function parseTimestamp(input: string, opts: ParseOptions = {}): ParseResult {
  const unit = opts.unit ?? 'auto'
  const timeZone = opts.timeZone ?? 'UTC'

  const trimmed = input.trim()
  if (trimmed === '') return fail('empty', 'Enter a timestamp.')
  const lead = input.length - input.trimStart().length

  const epoch = EPOCH_RE.exec(trimmed)
  if (epoch !== null) return parseEpoch(epoch, unit)

  const iso = ISO_RE.exec(trimmed)
  if (iso !== null) return parseIso(iso, lead, timeZone)

  // Number-shaped but malformed (`1__0`, `1.`, `,5`): say so, rather than let
  // Date.parse guess at it and return some unrelated date.
  if (/^[+-]?[\d_,.]+$/.test(trimmed)) {
    return fail('invalid', 'Not a valid number: digit separators (_ or ,) must sit between digits.', lead)
  }

  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) return fail('invalid', 'Not a recognised timestamp. Try epoch seconds, milliseconds, or ISO 8601 like 2024-03-10T09:30:00Z.')
  return {
    ok: true,
    value: {
      ns: BigInt(ms) * NS_PER_MS,
      detected: { kind: 'loose' },
      notes: ['Not ISO 8601: parsed by the browser’s Date.parse, whose rules are implementation-defined and may differ elsewhere.'],
    },
  }
}

/** A one-line summary of what the input was taken to be, for the UI. */
export function describeDetected(d: Detected): string {
  switch (d.kind) {
    case 'epoch':
      return d.auto ? `Detected: ${UNIT_NAMES[d.unit]}` : `Unit: ${UNIT_NAMES[d.unit]}`
    case 'iso':
      return d.offset === 'Z' ? 'Detected: ISO 8601, UTC' : `Detected: ISO 8601, offset ${d.offset}`
    case 'iso-local':
      return `Detected: ISO 8601, no offset (read in ${d.timeZone})`
    case 'date':
      return 'Detected: date only, UTC midnight'
    case 'loose':
      return 'Loose parse (Date.parse)'
  }
}
