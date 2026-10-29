import { fail, quoteChar, trimBounds, type Parsed } from './error.ts'

export const MIN_BASE = 2
export const MAX_BASE = 36

/**
 * Far past any real id, hash or mask, and still ~100 ms to convert on the
 * main thread. A million-digit paste takes most of a second, then has to be
 * rendered six times over.
 */
export const MAX_DIGITS = 100_000

export type Prefix = '0x' | '0b' | '0o'

const PREFIX_BASE: Record<Prefix, number> = { '0x': 16, '0b': 2, '0o': 8 }

const BASE_NAMES: Record<number, string> = { 2: 'binary', 8: 'octal', 10: 'decimal', 16: 'hex' }

export function baseName(base: number): string {
  return BASE_NAMES[base] ?? `base ${base}`
}

export function isValidBase(base: number): boolean {
  return Number.isInteger(base) && base >= MIN_BASE && base <= MAX_BASE
}

/** Digit separators people paste in: `1_000_000`, `1,000,000`, `ff ff ff ff`. */
function isSeparator(ch: string): boolean {
  return ch === '_' || ch === ',' || /\s/.test(ch)
}

function digitValue(ch: string): number {
  const c = ch.charCodeAt(0)
  if (c >= 48 && c <= 57) return c - 48
  if (c >= 97 && c <= 122) return c - 87
  if (c >= 65 && c <= 90) return c - 55
  return -1
}

export interface ParsedInteger {
  value: bigint
  /** The base the digits were actually read in, after any prefix. */
  base: number
  /** Set when a prefix overrode the selected base, so the UI can say so. */
  prefix: Prefix | null
}

/**
 * Parse an integer of any size in base 2–36.
 *
 * BigInt end to end: going through `Number` silently rounds anything past
 * 2^53, which is exactly the range (64-bit ids, hashes, masks) people paste
 * into a base converter. A `0x`/`0b`/`0o` prefix overrides `base`, and the
 * result reports that it did, because `0b10` in hex mode is otherwise a
 * silent surprise.
 */
export function parseInteger(input: string, base: number): Parsed<ParsedInteger> {
  if (!isValidBase(base)) {
    return fail('invalid-base', `Base must be a whole number from ${MIN_BASE} to ${MAX_BASE}.`)
  }
  const [start, end] = trimBounds(input)
  if (start === end) return fail('empty', 'Enter a number.')

  let i = start
  let negative = false
  if (input[i] === '-' || input[i] === '+') {
    negative = input[i] === '-'
    i++
  }
  while (i < end && isSeparator(input[i] ?? '')) i++

  let prefix: Prefix | null = null
  const maybePrefix = input.slice(i, i + 2).toLowerCase()
  if (maybePrefix === '0x' || maybePrefix === '0b' || maybePrefix === '0o') {
    prefix = maybePrefix
    base = PREFIX_BASE[prefix]
    i += 2
  }

  let digits = ''
  for (; i < end; i++) {
    const ch = input[i] ?? ''
    if (isSeparator(ch)) continue
    const d = digitValue(ch)
    if (d < 0 || d >= base) {
      const message =
        ch === '.'
          ? 'Only whole numbers can be converted between bases.'
          : ch === '-' || ch === '+'
            ? 'A sign is only allowed at the start.'
            : d < 0
              ? `${quoteChar(ch)} is not a digit.`
              : `${quoteChar(ch)} is not a valid digit in ${baseName(base)}.`
      return fail('invalid-digit', message, i, ch)
    }
    digits += ch
  }

  if (digits === '') {
    return prefix !== null
      ? fail('empty', `No digits after ${prefix}.`, end)
      : fail('empty', 'Enter a number.', end)
  }
  if (digits.length > MAX_DIGITS) {
    return fail('too-long', `That is ${digits.length.toLocaleString('en-US')} digits; the limit is ${MAX_DIGITS.toLocaleString('en-US')}.`)
  }

  const magnitude = digitsToBigInt(digits.toLowerCase(), base)
  return { ok: true, value: negative ? -magnitude : magnitude, base, prefix }
}

/**
 * `BigInt()` parses bases 2/8/10/16 natively and fast. Other bases go through
 * chunks small enough that each fits a double exactly, which keeps the BigInt
 * multiply count at n/k instead of n.
 */
function digitsToBigInt(digits: string, base: number): bigint {
  if (base === 10) return BigInt(digits)
  if (base === 16) return BigInt(`0x${digits}`)
  if (base === 8) return BigInt(`0o${digits}`)
  if (base === 2) return BigInt(`0b${digits}`)

  const chunk = Math.floor(53 / Math.log2(base)) - 1
  const b = BigInt(base)
  let value = 0n
  for (let i = 0; i < digits.length; i += chunk) {
    const part = digits.slice(i, i + chunk)
    value = value * b ** BigInt(part.length) + BigInt(parseInt(part, base))
  }
  return value
}

/** Lowercase digits, with a leading `-` for negatives and no prefix. */
export function formatInBase(value: bigint, base: number): string {
  return value.toString(base)
}

/**
 * Space digits into groups from the right, for display only: `11111111` →
 * `1111 1111`. The grouped form still parses back, because spaces are
 * separators to `parseInteger`.
 */
export function groupDigits(digits: string, size: number, separator = ' '): string {
  const negative = digits.startsWith('-')
  const body = negative ? digits.slice(1) : digits
  if (size <= 0 || body.length <= size) return digits
  const head = body.length % size
  const groups: string[] = []
  if (head > 0) groups.push(body.slice(0, head))
  for (let i = head; i < body.length; i += size) groups.push(body.slice(i, i + size))
  return (negative ? '-' : '') + groups.join(separator)
}

/** Bits needed for the magnitude. 0 needs none. */
export function bitLength(value: bigint): number {
  const abs = value < 0n ? -value : value
  return abs === 0n ? 0 : abs.toString(2).length
}

/** The narrowest two's-complement width, sign bit included, that holds `value`. */
export function signedBitLength(value: bigint): number {
  return value < 0n ? bitLength(-value - 1n) + 1 : bitLength(value) + 1
}

export const TWOS_WIDTHS = [8, 16, 32, 64] as const
export type TwosWidth = (typeof TWOS_WIDTHS)[number]

export type TwosComplement =
  | { bits: TwosWidth; fits: true; bin: string; hex: string }
  | { bits: TwosWidth; fits: false }

/**
 * Two's complement of `value` at a fixed width, or `fits: false` when it lies
 * outside the signed range. -128 fits in 8 bits; -129 does not.
 */
export function twosComplement(value: bigint, bits: TwosWidth): TwosComplement {
  const width = BigInt(bits)
  const min = -(1n << (width - 1n))
  const max = (1n << (width - 1n)) - 1n
  if (value < min || value > max) return { bits, fits: false }
  const raw = value < 0n ? (1n << width) + value : value
  return {
    bits,
    fits: true,
    bin: raw.toString(2).padStart(bits, '0'),
    hex: raw.toString(16).padStart(bits / 4, '0'),
  }
}

export interface BaseOutputs {
  bin: string
  oct: string
  dec: string
  hex: string
  base36: string
  custom: string
}

export interface BaseConversion extends ParsedInteger {
  negative: boolean
  bitLength: number
  signedBitLength: number
  customBase: number
  outputs: BaseOutputs
  /** Only for negative values; empty otherwise. */
  twos: TwosComplement[]
}

export function convertBase(input: string, fromBase: number, customBase: number): Parsed<BaseConversion> {
  if (!isValidBase(customBase)) {
    return fail('invalid-base', `Custom base must be a whole number from ${MIN_BASE} to ${MAX_BASE}.`)
  }
  const parsed = parseInteger(input, fromBase)
  if (!parsed.ok) return parsed
  const { value } = parsed
  return {
    ok: true,
    value,
    base: parsed.base,
    prefix: parsed.prefix,
    negative: value < 0n,
    bitLength: bitLength(value),
    signedBitLength: signedBitLength(value),
    customBase,
    outputs: {
      bin: formatInBase(value, 2),
      oct: formatInBase(value, 8),
      dec: formatInBase(value, 10),
      hex: formatInBase(value, 16),
      base36: formatInBase(value, 36),
      custom: formatInBase(value, customBase),
    },
    twos: value < 0n ? TWOS_WIDTHS.map((bits) => twosComplement(value, bits)) : [],
  }
}
