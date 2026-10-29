import { fail, quoteChar, trimBounds, type Parsed } from './error.ts'

/** [read, write, execute] */
export type Triplet = [boolean, boolean, boolean]
/** [owner, group, other] */
export type PermMatrix = [Triplet, Triplet, Triplet]

export interface SpecialBits {
  setuid: boolean
  setgid: boolean
  sticky: boolean
}

export interface Permissions {
  /** 0 … 0o7777 */
  mode: number
  /** The `ls -l` type character (`-`, `d`, `l`, …) when the input had one. */
  fileType: string | null
  /** 3 digits, or 4 when a special bit is set. */
  octal: string
  /** 9 characters: `rwxr-xr-x`. */
  symbolic: string
  matrix: PermMatrix
  special: SpecialBits
  chmod: { octal: string; symbolic: string }
}

const SETUID = 0o4000
const SETGID = 0o2000
const STICKY = 0o1000

/** `ls -l` type characters: file, dir, link, block, char, pipe, socket, door. */
const FILE_TYPES = '-dlbcpsD'
/** Trailing `ls -l` markers for an ACL, an SELinux context, or xattrs (macOS). */
const ALT_ACCESS = '+.@'

const WHO = ['u', 'g', 'o'] as const

export function describeMode(mode: number, fileType: string | null = null): Permissions {
  mode &= 0o7777
  const special: SpecialBits = {
    setuid: (mode & SETUID) !== 0,
    setgid: (mode & SETGID) !== 0,
    sticky: (mode & STICKY) !== 0,
  }
  const triplet = (shift: number): Triplet => [
    (mode & (4 << shift)) !== 0,
    (mode & (2 << shift)) !== 0,
    (mode & (1 << shift)) !== 0,
  ]
  const matrix: PermMatrix = [triplet(6), triplet(3), triplet(0)]
  const specialOn = [special.setuid, special.setgid, special.sticky]

  // The execute slot doubles as the special-bit slot: lowercase s/t means
  // "special and executable", uppercase S/T means "special but not". That is
  // why S vs s matters and must round-trip.
  let symbolic = ''
  const clauses: string[] = []
  matrix.forEach(([r, w, x], who) => {
    const on = specialOn[who] === true
    const mark = who === 2 ? 't' : 's'
    symbolic += (r ? 'r' : '-') + (w ? 'w' : '-')
    symbolic += on ? (x ? mark : mark.toUpperCase()) : x ? 'x' : '-'
    clauses.push(`${WHO[who]}=${r ? 'r' : ''}${w ? 'w' : ''}${x ? 'x' : ''}${on ? mark : ''}`)
  })

  const octal = mode.toString(8).padStart(mode > 0o777 ? 4 : 3, '0')
  return {
    mode,
    fileType,
    octal,
    symbolic,
    matrix,
    special,
    chmod: { octal: `chmod ${octal} file`, symbolic: `chmod ${clauses.join(',')} file` },
  }
}

/** Rebuild from the UI's checkbox grid. */
export function fromBits(matrix: PermMatrix, special: SpecialBits, fileType: string | null = null): Permissions {
  let mode = 0
  matrix.forEach(([r, w, x], who) => {
    const shift = (2 - who) * 3
    mode |= ((r ? 4 : 0) | (w ? 2 : 0) | (x ? 1 : 0)) << shift
  })
  if (special.setuid) mode |= SETUID
  if (special.setgid) mode |= SETGID
  if (special.sticky) mode |= STICKY
  return describeMode(mode, fileType)
}

function parseOctal(input: string, start: number, end: number): Parsed<Permissions> {
  let i = start
  if (input.slice(i, i + 2).toLowerCase() === '0o') i += 2
  if (i === end) return fail('empty', 'No digits after 0o.', end)
  const digitsStart = i
  for (; i < end; i++) {
    const ch = input[i] ?? ''
    if (ch === '8' || ch === '9') return fail('invalid-digit', `${ch} is not an octal digit (0–7).`, i, ch)
    if (ch < '0' || ch > '7') return fail('invalid-digit', `${quoteChar(ch)} is not an octal digit (0–7).`, i, ch)
  }
  const digits = input.slice(digitsStart, end)
  const significant = digits.replace(/^0+(?=.)/, '')
  if (significant.length > 4) {
    return fail(
      'too-long',
      'A mode has at most 4 octal digits: special bits, then owner, group, other.',
      end - significant.length,
      significant[0] ?? '',
    )
  }
  return { ok: true, ...describeMode(parseInt(significant, 8)) }
}

/** What each of the 9 positions may hold, after `-`. */
const SLOTS = ['r', 'w', 'xsS', 'r', 'w', 'xsS', 'r', 'w', 'xtT'] as const

function expectedText(slot: string): string {
  return [...slot, '-'].map((c) => `“${c}”`).join(', ').replace(/, ([^,]*)$/, ' or $1')
}

function parseSymbolic(input: string, start: number, end: number): Parsed<Permissions> {
  const length = end - start
  let i = start
  let fileType: string | null = null

  if (length !== 9 && length !== 10 && length !== 11) {
    return fail(
      'wrong-length',
      `Symbolic permissions are 9 characters (rwxr-xr-x), or 10 with the ls -l type (drwxr-xr-x); this is ${length}.`,
      length > 11 ? start + 11 : end,
    )
  }
  if (length >= 10) {
    const t = input[i] ?? ''
    if (!FILE_TYPES.includes(t)) {
      return fail('invalid-char', `${quoteChar(t)} is not an ls -l file type (one of ${FILE_TYPES}).`, i, t)
    }
    fileType = t
    i++
  }

  let mode = 0
  for (let slot = 0; slot < 9; slot++, i++) {
    const ch = input[i] ?? ''
    const allowed = SLOTS[slot] ?? ''
    if (ch === '-') continue
    if (!allowed.includes(ch)) {
      return fail('invalid-char', `Expected ${expectedText(allowed)} here, found ${quoteChar(ch)}.`, i, ch)
    }
    const who = Math.floor(slot / 3)
    const shift = (2 - who) * 3
    if (ch === 'r') mode |= 4 << shift
    else if (ch === 'w') mode |= 2 << shift
    else {
      if (ch !== 'S' && ch !== 'T') mode |= 1 << shift
      if (ch !== 'x') mode |= who === 0 ? SETUID : who === 1 ? SETGID : STICKY
    }
  }

  if (length === 11) {
    const m = input[i] ?? ''
    if (!ALT_ACCESS.includes(m)) {
      return fail('invalid-char', `Only “+”, “.” or “@” may follow the permissions, found ${quoteChar(m)}.`, i, m)
    }
  }
  return { ok: true, ...describeMode(mode, fileType) }
}

/**
 * Parse `755`, `0755`, `4755`, `0o755`, `rwxr-xr-x`, or an `ls -l` column such
 * as `drwxr-xr-t` or `-rw-r--r--@`. A leading digit selects octal.
 */
export function parsePermissions(input: string): Parsed<Permissions> {
  const [start, end] = trimBounds(input)
  if (start === end) return fail('empty', 'Enter a mode like 755 or rwxr-xr-x.')
  const first = input[start] ?? ''
  return first >= '0' && first <= '9' ? parseOctal(input, start, end) : parseSymbolic(input, start, end)
}

/**
 * The text to put back in the input after the checkboxes change, in the form
 * the user was already typing: octal stays octal, `ls -l` keeps its type.
 */
export function formatLike(previous: string, perms: Permissions): string {
  const [start, end] = trimBounds(previous)
  const first = previous[start] ?? ''
  if (start === end || (first >= '0' && first <= '9')) return perms.octal
  return (perms.fileType ?? '') + perms.symbolic
}
