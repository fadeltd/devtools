import { decodeUlidTime, isUlid, ULID_LENGTH } from './ulid.ts'

/**
 * Identify a pasted UUID or ULID and decode what it carries: the UUID version
 * and variant, and the embedded creation time for v1, v6, v7 and ULID.
 */

export type UuidVariant = 'ncs' | 'rfc9562' | 'microsoft' | 'future'

export interface IdInspection {
  kind: 'uuid' | 'ulid'
  /** Short name: "UUID v7", "Nil UUID", "ULID". */
  label: string
  /** One line on what this kind of id is. */
  description: string
  /** Normalised: lowercase hyphenated for a UUID, uppercase for a ULID. */
  canonical: string
  /** Anything before the id, including its separator (`user_`), or ''. */
  prefix: string
  /** UUID only, and only for the RFC 9562 variant, where the field means something. */
  version?: number
  variant?: UuidVariant
  special?: 'nil' | 'max'
  /** The creation time the id embeds, if it embeds one. */
  time?: { ms: number; iso: string }
}

const UUID_HYPHENATED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_PLAIN = /^[0-9a-f]{32}$/i

const VERSIONS: Record<number, string> = {
  1: 'Gregorian time and node id (often a MAC address).',
  2: 'DCE Security: a v1 with a POSIX uid or gid in place of part of the time.',
  3: 'Name-based, MD5 hash of a namespace and a name.',
  4: 'Random: 122 random bits.',
  5: 'Name-based, SHA-1 hash of a namespace and a name.',
  6: 'Gregorian time reordered so the id sorts by time.',
  7: 'Unix ms time first, then random bits, so it sorts by time.',
  8: 'Custom: the layout is up to the application.',
}

const VARIANT_DESCRIPTION: Record<Exclude<UuidVariant, 'rfc9562'>, string> = {
  ncs: 'NCS variant, a pre-RFC layout reserved for backward compatibility.',
  microsoft: 'Microsoft variant, reserved for old COM/DCOM GUIDs.',
  future: 'Reserved variant, not defined by any spec.',
}

/** 100 ns intervals from 1582-10-15 (the Gregorian reform) to the Unix epoch. */
const GREGORIAN_OFFSET = 122_192_928_000_000_000

function variantOf(byte8: number): UuidVariant {
  if ((byte8 & 0x80) === 0) return 'ncs'
  if ((byte8 & 0xc0) === 0x80) return 'rfc9562'
  if ((byte8 & 0xe0) === 0xc0) return 'microsoft'
  return 'future'
}

function timeOf(ms: number): { ms: number; iso: string } | undefined {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? undefined : { ms, iso: date.toISOString() }
}

/** Gregorian 100 ns ticks to Unix ms. Float precision is ~13 µs at this size: ample. */
function gregorianToMs(ticks: number): number {
  return Math.floor((ticks - GREGORIAN_OFFSET) / 10_000)
}

function inspectUuid(hex: string, prefix: string): IdInspection {
  const bytes: number[] = []
  for (let i = 0; i < 32; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16))
  const b = (i: number) => bytes[i]!
  const canonical = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`

  if (/^0+$/.test(hex)) {
    return { kind: 'uuid', label: 'Nil UUID', description: 'All 128 bits zero: the "no value" UUID.', canonical, prefix, special: 'nil' }
  }
  if (/^f+$/.test(hex)) {
    return { kind: 'uuid', label: 'Max UUID', description: 'All 128 bits one: the RFC 9562 sentinel above every other UUID.', canonical, prefix, special: 'max' }
  }

  const variant = variantOf(b(8))
  if (variant !== 'rfc9562') {
    return { kind: 'uuid', label: 'UUID', description: VARIANT_DESCRIPTION[variant], canonical, prefix, variant }
  }

  const version = b(6) >>> 4
  const description = VERSIONS[version] ?? `Version ${version} is not one RFC 9562 defines.`
  const base: IdInspection = { kind: 'uuid', label: `UUID v${version}`, description, canonical, prefix, version, variant }

  let ms: number | undefined
  if (version === 1) {
    const low = b(0) * 2 ** 24 + b(1) * 2 ** 16 + b(2) * 2 ** 8 + b(3)
    const mid = b(4) * 2 ** 8 + b(5)
    const high = (b(6) & 0x0f) * 2 ** 8 + b(7)
    ms = gregorianToMs(high * 2 ** 48 + mid * 2 ** 32 + low)
  } else if (version === 6) {
    const high = b(0) * 2 ** 24 + b(1) * 2 ** 16 + b(2) * 2 ** 8 + b(3)
    const mid = b(4) * 2 ** 8 + b(5)
    const low = (b(6) & 0x0f) * 2 ** 8 + b(7)
    ms = gregorianToMs(high * 2 ** 28 + mid * 2 ** 12 + low)
  } else if (version === 7) {
    ms = 0
    for (let i = 0; i < 6; i++) ms = ms * 256 + b(i)
  }
  const time = ms === undefined ? undefined : timeOf(ms)
  return time === undefined ? base : { ...base, time }
}

function inspectUlid(value: string, prefix: string): IdInspection {
  const canonical = value.toUpperCase()
  const ms = decodeUlidTime(canonical)!
  const base: IdInspection = {
    kind: 'ulid',
    label: 'ULID',
    description: 'Unix ms time, then 80 random bits, in Crockford base32. Sorts by time.',
    canonical,
    prefix,
  }
  const time = timeOf(ms)
  return time === undefined ? base : { ...base, time }
}

function inspectExact(value: string, prefix: string): IdInspection | null {
  if (UUID_HYPHENATED.test(value)) return inspectUuid(value.replaceAll('-', '').toLowerCase(), prefix)
  if (UUID_PLAIN.test(value)) return inspectUuid(value.toLowerCase(), prefix)
  if (isUlid(value)) return inspectUlid(value, prefix)
  return null
}

/**
 * Recognise a UUID (any version, hyphenated or not, in braces or as a
 * `urn:uuid:`) or a ULID, optionally behind a prefix that ends in a separator
 * (`user_01J…`, `cus-…`). Returns null when the value is neither.
 */
export function inspectId(input: string): IdInspection | null {
  let value = input.trim()
  if (/^urn:uuid:/i.test(value)) value = value.slice('urn:uuid:'.length)
  if (value.startsWith('{') && value.endsWith('}')) value = value.slice(1, -1)
  if (value === '') return null

  const exact = inspectExact(value, '')
  if (exact !== null) return exact

  // A prefixed id: try each id length as a suffix, and accept it only when the
  // character before it is a separator, so `abc` + 26 chars is not read as a
  // ULID sliced out of the middle of a longer token.
  for (const length of [36, 32, ULID_LENGTH]) {
    if (value.length <= length) continue
    const prefix = value.slice(0, -length)
    if (/[0-9a-z]$/i.test(prefix)) continue
    const found = inspectExact(value.slice(-length), prefix)
    if (found !== null) return found
  }
  return null
}
