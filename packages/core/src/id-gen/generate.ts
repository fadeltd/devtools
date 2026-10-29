import { cryptoRandomSource, unbiasedBelow, type RandomSource } from '../random/random.ts'
import { CROCKFORD, ULID_ENTROPY_BITS, UlidOverflowError, ulidGenerator } from './ulid.ts'
import {
  UUID_V4_ENTROPY_BITS,
  UUID_V7_ENTROPY_BITS,
  formatUuid,
  uuidV4Bytes,
  uuidV7Generator,
} from './uuid.ts'

/**
 * Prefixed identifier generation, in the shape Stripe popularised:
 * a readable prefix, a separator, then a run of random characters
 * (`sk_live_` followed by 24 alphanumerics).
 *
 * The example above is written out rather than shown as a literal on purpose:
 * a realistic-looking key in source trips secret scanners, which cannot tell a
 * documentation example from a real leak -- and should not have to.
 *
 * A readable prefix carries the environment and the object type, so an id is
 * self-describing in a log line, and a leaked key is identifiable on sight.
 */

export const ALPHABETS = {
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  lowercase: 'abcdefghijklmnopqrstuvwxyz0123456789',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  numeric: '0123456789',
  hex: '0123456789abcdef',
  /** Bitcoin base58: alphanumeric minus 0, O, I and l. */
  base58: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  /** Adds symbols, for password use. */
  password: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.?',
} as const

export type AlphabetName = keyof typeof ALPHABETS

/**
 * Glyphs that are easily confused when read aloud or transcribed by hand.
 * Worth excluding for anything a human will retype; pointless for a machine
 * token, which is why it is optional.
 */
const AMBIGUOUS = new Set('O0oIl1|`\'"~,.;:')

/**
 * What the part after the prefix is. `random` draws `length` characters from
 * an alphabet; the others are fixed-shape standard ids, for which length,
 * alphabet and the ambiguity filter do not apply.
 */
export type IdFormat = 'random' | 'uuid-v4' | 'uuid-v7' | 'ulid'

/**
 * `canonical` is each format's standard case: lowercase for a UUID (RFC 9562),
 * uppercase for a ULID. One setting rather than an "uppercase" boolean, so
 * switching format never silently leaves a ULID in non-canonical case.
 */
export type LetterCase = 'canonical' | 'lower' | 'upper'

export interface IdOptions {
  format: IdFormat
  prefix: string
  separator: string
  /** Length of the random portion only, excluding prefix and separator. */
  length: number
  alphabet: AlphabetName | 'custom'
  customAlphabet?: string
  excludeAmbiguous: boolean
  count: number
  /** UUID and ULID only. Ignored by `random`, which takes its case from the alphabet. */
  letterCase: LetterCase
  /** UUID only: the 8-4-4-4-12 grouping. */
  hyphens: boolean
}

export const DEFAULT_OPTIONS: IdOptions = {
  format: 'random',
  prefix: 'sk_live',
  separator: '_',
  length: 24,
  alphabet: 'alphanumeric',
  excludeAmbiguous: false,
  count: 10,
  letterCase: 'canonical',
  hyphens: true,
}

/** Deduplicated so a repeated character cannot skew the distribution. */
export function resolveAlphabet(options: Pick<IdOptions, 'alphabet' | 'customAlphabet' | 'excludeAmbiguous'>): string {
  const base =
    options.alphabet === 'custom'
      ? (options.customAlphabet ?? '')
      : ALPHABETS[options.alphabet]

  const seen = new Set<string>()
  let out = ''
  for (const ch of base) {
    if (seen.has(ch)) continue
    if (options.excludeAmbiguous && AMBIGUOUS.has(ch)) continue
    seen.add(ch)
    out += ch
  }
  return out
}

export type GenerateError =
  | 'empty-alphabet'
  | 'invalid-length'
  | 'invalid-count'
  /** The clock is outside the 48-bit ms range a UUID v7 or ULID can encode. */
  | 'time-out-of-range'
  /** A monotonic ULID's random part overflowed within one millisecond. */
  | 'ulid-overflow'

export interface GenerateResult {
  ids: string[]
  /** Characters the random portion is drawn from: 16 for a UUID, 32 for a ULID. */
  alphabetSize: number
  /**
   * Entropy of the random portion. The prefix contributes none -- it is
   * public -- and neither do a UUID's version and variant bits, a v7's
   * timestamp and counter, or a ULID's timestamp.
   */
  entropyBits: number
  /**
   * Set for formats whose entropy figure alone would overstate what the id is
   * good for. `strength()` rates bits; this says what the bits cannot.
   */
  caveat?: string
  error?: GenerateError
}

export const MAX_COUNT = 1000
export const MAX_LENGTH = 512

const TIME_ORDERED_CAVEAT =
  'Time-ordered: anyone holding the id can read when it was made. Use it as an identifier, never as a secret.'

const FORMAT_ENTROPY: Record<Exclude<IdFormat, 'random'>, { alphabetSize: number; entropyBits: number; caveat?: string }> = {
  'uuid-v4': { alphabetSize: 16, entropyBits: UUID_V4_ENTROPY_BITS },
  'uuid-v7': { alphabetSize: 16, entropyBits: UUID_V7_ENTROPY_BITS, caveat: TIME_ORDERED_CAVEAT },
  ulid: {
    alphabetSize: CROCKFORD.length,
    entropyBits: ULID_ENTROPY_BITS,
    caveat:
      'Time-ordered: anyone holding the id can read when it was made, and ids from the same millisecond count up by one, so one reveals its neighbours. Use it as an identifier, never as a secret.',
  },
}

function isValidCount(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= MAX_COUNT
}

/**
 * Generate a batch of ids.
 *
 * `now` is the clock for the time-ordered formats (UUID v7, ULID). A batch
 * shares one monotonic generator, so ids made in the same millisecond still
 * sort in the order they were generated.
 */
export function generateIds(
  options: IdOptions,
  source?: RandomSource,
  now?: () => number,
): GenerateResult {
  // Persisted state from before formats existed has no `format`; treat it as random.
  const format = options.format ?? 'random'
  if (format !== 'random') return generateStandardIds(format, options, source, now)

  const alphabet = resolveAlphabet(options)
  const alphabetSize = alphabet.length

  if (alphabetSize === 0) {
    return { ids: [], alphabetSize: 0, entropyBits: 0, error: 'empty-alphabet' }
  }
  if (!Number.isInteger(options.length) || options.length < 1 || options.length > MAX_LENGTH) {
    return { ids: [], alphabetSize, entropyBits: 0, error: 'invalid-length' }
  }
  if (!isValidCount(options.count)) {
    return { ids: [], alphabetSize, entropyBits: 0, error: 'invalid-count' }
  }

  const next = source ?? cryptoRandomSource()
  const chars = [...alphabet]
  const head = options.prefix === '' ? '' : options.prefix + options.separator

  const ids: string[] = []
  for (let n = 0; n < options.count; n++) {
    let body = ''
    for (let i = 0; i < options.length; i++) {
      // Rejection sampling, not modulo: `value % size` biases toward the start
      // of the alphabet whenever size does not divide 2^32.
      body += chars[unbiasedBelow(next, chars.length)]
    }
    ids.push(head + body)
  }

  return { ids, alphabetSize, entropyBits: entropyBits(alphabetSize, options.length) }
}

function generateStandardIds(
  format: Exclude<IdFormat, 'random'>,
  options: IdOptions,
  source: RandomSource | undefined,
  now: (() => number) | undefined,
): GenerateResult {
  const { alphabetSize, entropyBits: bits, caveat } = FORMAT_ENTROPY[format]
  const fail = (error: GenerateError): GenerateResult => ({ ids: [], alphabetSize, entropyBits: 0, error })
  if (!isValidCount(options.count)) return fail('invalid-count')

  const next = source ?? cryptoRandomSource()
  const head = options.prefix === '' ? '' : options.prefix + options.separator
  const letterCase = options.letterCase ?? 'canonical'
  const clock = now === undefined ? {} : { now }

  let make: () => string
  if (format === 'ulid') {
    const gen = ulidGenerator({ source: next, ...clock })
    make = letterCase === 'lower' ? () => gen().toLowerCase() : gen
  } else {
    const uuidFormat = { uppercase: letterCase === 'upper', hyphens: options.hyphens !== false }
    if (format === 'uuid-v4') {
      make = () => formatUuid(uuidV4Bytes(next), uuidFormat)
    } else {
      const gen = uuidV7Generator({ source: next, ...clock })
      make = () => formatUuid(gen(), uuidFormat)
    }
  }

  const ids: string[] = []
  try {
    for (let n = 0; n < options.count; n++) ids.push(head + make())
  } catch (e) {
    // Never return a partial batch: a truncated list could pass for a full one.
    if (e instanceof UlidOverflowError) return fail('ulid-overflow')
    if (e instanceof RangeError) return fail('time-out-of-range')
    throw e
  }
  const result: GenerateResult = { ids, alphabetSize, entropyBits: bits }
  if (caveat !== undefined) result.caveat = caveat
  return result
}

export function entropyBits(alphabetSize: number, length: number): number {
  if (alphabetSize <= 1 || length <= 0) return 0
  return Math.log2(alphabetSize) * length
}

export type Strength = 'weak' | 'fair' | 'strong' | 'excessive'

export interface StrengthVerdict {
  level: Strength
  label: string
  detail: string
}

/**
 * Qualitative strength from entropy.
 *
 * Deliberately not a "time to crack" figure: that number depends entirely on
 * assumed hardware and on whether the value is hashed and how, so quoting one
 * would be false precision dressed up as a guarantee.
 */
export function strength(bits: number): StrengthVerdict {
  if (bits < 64) {
    return {
      level: 'weak',
      label: 'Weak',
      detail: 'Fine for a non-secret identifier, but not for anything that authenticates.',
    }
  }
  if (bits < 80) {
    return {
      level: 'fair',
      label: 'Fair',
      detail: 'Acceptable for a short-lived token. Prefer more for a long-lived secret.',
    }
  }
  if (bits <= 256) {
    return {
      level: 'strong',
      label: 'Strong',
      detail: 'Comfortably beyond brute force for a credential of this kind.',
    }
  }
  return {
    level: 'excessive',
    label: 'Very high',
    detail: 'Far beyond any practical need. Extra length costs storage and legibility.',
  }
}

export interface Preset {
  name: string
  description: string
  options: Partial<IdOptions>
}

export const PRESETS: readonly Preset[] = [
  {
    name: 'Stripe secret key',
    description: 'sk_live_ plus 24 alphanumeric characters',
    options: { format: 'random', prefix: 'sk_live', separator: '_', length: 24, alphabet: 'alphanumeric' },
  },
  {
    name: 'Stripe test key',
    description: 'sk_test_ plus 24 alphanumeric characters',
    options: { format: 'random', prefix: 'sk_test', separator: '_', length: 24, alphabet: 'alphanumeric' },
  },
  {
    name: 'Object id',
    description: 'A short prefixed id, e.g. cus_ or evt_',
    options: { format: 'random', prefix: 'cus', separator: '_', length: 14, alphabet: 'alphanumeric' },
  },
  {
    name: 'API token',
    description: '40 alphanumeric characters, no prefix',
    options: { format: 'random', prefix: '', separator: '', length: 40, alphabet: 'alphanumeric' },
  },
  {
    name: 'Hex token',
    description: '32 hex characters, like a session id',
    options: { format: 'random', prefix: '', separator: '', length: 32, alphabet: 'hex' },
  },
  {
    name: 'Password',
    description: '20 characters with symbols, ambiguous glyphs removed',
    options: {
      format: 'random',
      prefix: '',
      separator: '',
      length: 20,
      alphabet: 'password',
      excludeAmbiguous: true,
      count: 5,
    },
  },
  {
    name: 'Readable code',
    description: 'base58 with ambiguous glyphs removed, for codes people retype',
    options: { format: 'random', prefix: '', separator: '', length: 10, alphabet: 'base58', excludeAmbiguous: true },
  },
  {
    name: 'UUID v4',
    description: 'Random UUID in RFC 9562 canonical form',
    options: { format: 'uuid-v4', prefix: '', separator: '', letterCase: 'canonical', hyphens: true },
  },
  {
    name: 'UUID v7',
    description: 'Time-ordered UUID: sorts by creation time, good as a database key',
    options: { format: 'uuid-v7', prefix: '', separator: '', letterCase: 'canonical', hyphens: true },
  },
  {
    name: 'ULID',
    description: '26 characters of Crockford base32, time-ordered',
    options: { format: 'ulid', prefix: '', separator: '', letterCase: 'canonical' },
  },
  {
    name: 'Prefixed ULID',
    description: 'A typed, time-ordered object id such as user_01J…',
    options: { format: 'ulid', prefix: 'user', separator: '_', letterCase: 'canonical' },
  },
]

/**
 * Name the preset whose settings the current options match, if any.
 *
 * Derived rather than stored: the dropdown then shows the right thing after a
 * reload, and falls back to "Custom" the moment any field is changed, with no
 * state to keep in sync.
 */
export function matchingPreset(options: IdOptions): string | null {
  for (const preset of PRESETS) {
    const keys = Object.keys(preset.options) as (keyof IdOptions)[]
    if (keys.every((k) => options[k] === preset.options[k])) return preset.name
  }
  return null
}
