import { cryptoRandomSource, unbiasedBelow, type RandomSource } from '@/lib/random'

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

export interface IdOptions {
  prefix: string
  separator: string
  /** Length of the random portion only, excluding prefix and separator. */
  length: number
  alphabet: AlphabetName | 'custom'
  customAlphabet?: string
  excludeAmbiguous: boolean
  count: number
}

export const DEFAULT_OPTIONS: IdOptions = {
  prefix: 'sk_live',
  separator: '_',
  length: 24,
  alphabet: 'alphanumeric',
  excludeAmbiguous: false,
  count: 10,
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

export type GenerateError = 'empty-alphabet' | 'invalid-length' | 'invalid-count'

export interface GenerateResult {
  ids: string[]
  alphabetSize: number
  /** Entropy of the random portion. The prefix contributes none -- it is public. */
  entropyBits: number
  error?: GenerateError
}

export const MAX_COUNT = 1000
export const MAX_LENGTH = 512

export function generateIds(options: IdOptions, source?: RandomSource): GenerateResult {
  const alphabet = resolveAlphabet(options)
  const alphabetSize = alphabet.length

  if (alphabetSize === 0) {
    return { ids: [], alphabetSize: 0, entropyBits: 0, error: 'empty-alphabet' }
  }
  if (!Number.isInteger(options.length) || options.length < 1 || options.length > MAX_LENGTH) {
    return { ids: [], alphabetSize, entropyBits: 0, error: 'invalid-length' }
  }
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > MAX_COUNT) {
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
    options: { prefix: 'sk_live', separator: '_', length: 24, alphabet: 'alphanumeric' },
  },
  {
    name: 'Stripe test key',
    description: 'sk_test_ plus 24 alphanumeric characters',
    options: { prefix: 'sk_test', separator: '_', length: 24, alphabet: 'alphanumeric' },
  },
  {
    name: 'Object id',
    description: 'A short prefixed id, e.g. cus_ or evt_',
    options: { prefix: 'cus', separator: '_', length: 14, alphabet: 'alphanumeric' },
  },
  {
    name: 'API token',
    description: '40 alphanumeric characters, no prefix',
    options: { prefix: '', separator: '', length: 40, alphabet: 'alphanumeric' },
  },
  {
    name: 'Hex token',
    description: '32 hex characters, like a session id',
    options: { prefix: '', separator: '', length: 32, alphabet: 'hex' },
  },
  {
    name: 'Password',
    description: '20 characters with symbols, ambiguous glyphs removed',
    options: {
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
    options: { prefix: '', separator: '', length: 10, alphabet: 'base58', excludeAmbiguous: true },
  },
]
