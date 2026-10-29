import { groupDigits } from './base.ts'
import { fail, quoteChar, trimBounds, type Parsed } from './error.ts'

export type UnitFamily = 'byte' | 'si' | 'iec'

export interface ByteUnit {
  /** Canonical spelling: `B`, `kB`, `MiB`, … */
  symbol: string
  family: UnitFamily
  /** 0 for bytes, 1 for k/Ki, 2 for M/Mi, … */
  level: number
  factor: bigint
}

const LETTERS = ['k', 'm', 'g', 't', 'p'] as const

export const SI_UNITS: readonly ByteUnit[] = LETTERS.map((l, i) => ({
  symbol: (l === 'k' ? 'k' : l.toUpperCase()) + 'B',
  family: 'si' as const,
  level: i + 1,
  factor: 1000n ** BigInt(i + 1),
}))

export const IEC_UNITS: readonly ByteUnit[] = LETTERS.map((l, i) => ({
  symbol: l.toUpperCase() + 'iB',
  family: 'iec' as const,
  level: i + 1,
  factor: 1024n ** BigInt(i + 1),
}))

const BYTE_UNIT: ByteUnit = { symbol: 'B', family: 'byte', level: 0, factor: 1n }

/**
 * Lowercased spelling → unit. `KB` is SI here, as the spec and the drive
 * vendors have it; a bare `K`, `M`, `G` is genuinely ambiguous (`ls -h` and
 * `du -h` mean 1024, a spec sheet means 1000), so it is read as IEC and the
 * result is flagged.
 */
const UNIT_TABLE = new Map<string, { unit: ByteUnit; ambiguous: boolean }>([
  ['', { unit: BYTE_UNIT, ambiguous: false }],
  ['b', { unit: BYTE_UNIT, ambiguous: false }],
  ['byte', { unit: BYTE_UNIT, ambiguous: false }],
  ['bytes', { unit: BYTE_UNIT, ambiguous: false }],
])
LETTERS.forEach((l, i) => {
  const si = SI_UNITS[i]
  const iec = IEC_UNITS[i]
  if (si === undefined || iec === undefined) return
  UNIT_TABLE.set(`${l}b`, { unit: si, ambiguous: false })
  UNIT_TABLE.set(`${l}ib`, { unit: iec, ambiguous: false })
  UNIT_TABLE.set(l, { unit: iec, ambiguous: true })
})

export interface ScaledValue {
  unit: string
  /** Decimal string at a readable precision. */
  value: string
  /** False when `value` was rounded. */
  exact: boolean
}

export interface ByteSize {
  bytes: bigint
  /** The input named a fractional number of bytes, rounded to the nearest. */
  rounded: boolean
  unit: ByteUnit
  /** A bare K/M/G/T/P, read as the binary (IEC) unit. */
  ambiguous: boolean
  si: ScaledValue[]
  iec: ScaledValue[]
  /** The largest SI / IEC unit the size reaches at least 1 of, e.g. `1.5 GB`. */
  humanSi: string
  humanIec: string
  /** How much larger the IEC unit is than its SI namesake, at the input's scale. */
  gap: { si: string; iec: string; percent: string }
}

const MAX_FRACTION_DIGITS = 18

/**
 * `n / d` as a decimal string: 3 decimals at or above 1, 3 significant digits
 * below it. Exact BigInt arithmetic throughout, so a petabyte count does not
 * lose its low digits on the way to "PB".
 */
export function formatRatio(n: bigint, d: bigint): { value: string; exact: boolean } {
  if (n === 0n) return { value: '0', exact: true }
  let places = 3
  if (n < d) {
    let lead = 1
    while (lead <= MAX_FRACTION_DIGITS && n * 10n ** BigInt(lead) < d) lead++
    if (lead > MAX_FRACTION_DIGITS) return { value: '0', exact: false }
    places = Math.min(lead + 2, MAX_FRACTION_DIGITS)
  }
  const scale = 10n ** BigInt(places)
  const scaled = n * scale
  let q = scaled / d
  const r = scaled % d
  if (r * 2n >= d) q += 1n
  const int = q / scale
  const frac = (q % scale).toString().padStart(places, '0').replace(/0+$/, '')
  return { value: frac === '' ? int.toString() : `${int}.${frac}`, exact: r === 0n }
}

function human(bytes: bigint, units: readonly ByteUnit[]): string {
  let best: ByteUnit = BYTE_UNIT
  for (const u of units) if (bytes >= u.factor) best = u
  return `${formatRatio(bytes, best.factor).value} ${best.symbol}`
}

/** Pick out a leading number, allowing `_` and `1,234,567`-style thousands. */
function parseNumber(
  input: string,
  start: number,
  end: number,
): Parsed<{ intDigits: string; fracDigits: string; next: number }> {
  let i = start
  while (i < end && /[0-9.,_]/.test(input[i] ?? '')) i++
  const raw = input.slice(start, i)
  if (raw === '') {
    const ch = input[start] ?? ''
    return fail('invalid-number', `Expected a number, found ${quoteChar(ch)}.`, start, ch)
  }

  // A comma is only a thousands separator when it groups exactly three
  // digits. Anything else ("1,5") is a decimal comma we cannot tell apart
  // from a typo, so it is an error rather than a silent 15.
  const comma = raw.indexOf(',')
  if (comma >= 0 && !/^[0-9]{1,3}(,[0-9]{3})+(\.[0-9]*)?$/.test(raw)) {
    return fail(
      'invalid-number',
      'Commas are only allowed as thousands separators (1,234,567). Use a dot for decimals.',
      start + comma,
      ',',
    )
  }
  const firstDot = raw.indexOf('.')
  const secondDot = firstDot >= 0 ? raw.indexOf('.', firstDot + 1) : -1
  if (secondDot >= 0) return fail('invalid-number', 'A number has at most one decimal point.', start + secondDot, '.')

  const clean = raw.replace(/[_,]/g, '')
  const [intPart = '', fracPart = ''] = clean.split('.')
  if (intPart === '' && fracPart === '') {
    return fail('invalid-number', 'Expected a number.', start, raw[0] ?? '')
  }
  return { ok: true, intDigits: intPart, fracDigits: fracPart, next: i }
}

/**
 * Parse `1536`, `1.5 GB`, `1.5GiB`, `512 KiB`, `2 tb`. Unit names are
 * case-insensitive; bits are out of scope, so `kb` is kilobytes.
 */
export function parseByteSize(input: string): Parsed<ByteSize> {
  const [start, end] = trimBounds(input)
  if (start === end) return fail('empty', 'Enter a size, like 1.5 GB or 512 KiB.')

  let i = start
  if (input[i] === '-') return fail('negative', 'A size cannot be negative.', i, '-')
  if (input[i] === '+') i++

  const num = parseNumber(input, i, end)
  if (!num.ok) return num
  i = num.next
  while (i < end && /\s/.test(input[i] ?? '')) i++

  const unitText = input.slice(i, end)
  const entry = UNIT_TABLE.get(unitText.toLowerCase())
  if (entry === undefined) {
    const bad = unitText.search(/[^A-Za-z]/)
    if (bad >= 0) {
      const ch = unitText[bad] ?? ''
      return fail('invalid-unit', `The unit cannot contain ${quoteChar(ch)}.`, i + bad, ch)
    }
    return fail(
      'unknown-unit',
      `Unknown unit “${unitText}”. Use B, kB, MB, GB, TB, PB or KiB, MiB, GiB, TiB, PiB.`,
      i,
      unitText[0] ?? '',
    )
  }

  const { unit, ambiguous } = entry
  const scale = 10n ** BigInt(num.fracDigits.length)
  const total = BigInt(num.intDigits + num.fracDigits || '0') * unit.factor
  let bytes = total / scale
  const remainder = total % scale
  if (remainder * 2n >= scale) bytes += 1n

  const scaled = (units: readonly ByteUnit[]): ScaledValue[] =>
    units.map((u) => ({ unit: u.symbol, ...formatRatio(bytes, u.factor) }))

  // The gap only means something at a named scale. For a bare byte count use
  // the scale the IEC reading lands on, and never less than kilo.
  let level = unit.level
  if (level === 0) {
    level = 1
    for (const u of IEC_UNITS) if (bytes >= u.factor) level = u.level
  }
  const si = SI_UNITS[level - 1] ?? SI_UNITS[0]
  const iec = IEC_UNITS[level - 1] ?? IEC_UNITS[0]

  return {
    ok: true,
    bytes,
    rounded: remainder !== 0n,
    unit,
    ambiguous,
    si: scaled(SI_UNITS),
    iec: scaled(IEC_UNITS),
    humanSi: human(bytes, SI_UNITS),
    humanIec: human(bytes, IEC_UNITS),
    gap: {
      si: si?.symbol ?? 'kB',
      iec: iec?.symbol ?? 'KiB',
      percent: ((1.024 ** level - 1) * 100).toFixed(2),
    },
  }
}

/** `1610612736` → `1,610,612,736`, for display; copy the raw digits. */
export function groupThousands(value: bigint): string {
  return groupDigits(value.toString(), 3, ',')
}
