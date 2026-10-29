export type FilenameReplacement = '_' | '-' | ''

export interface FilenameOptions {
  /** What a forbidden character becomes. '' removes it outright. */
  replacement: FilenameReplacement
  /**
   * Byte cap on the UTF-8 encoding. 255 is the limit on ext4, APFS and NTFS
   * alike; clamped to [MIN_FILENAME_BYTES, 255].
   */
  maxBytes: number
}

export const DEFAULT_FILENAME_OPTIONS: FilenameOptions = { replacement: '_', maxBytes: 255 }

export const MAX_FILENAME_BYTES = 255
/** Room for the fallback name, so a tiny cap can never force an empty result. */
export const MIN_FILENAME_BYTES = 16
export const FALLBACK_FILENAME = 'untitled'

export interface FilenameChanges {
  /** Forbidden, control or unpaired-surrogate characters replaced or removed. */
  removedChars: number
  /** Leading/trailing whitespace or trailing dots were stripped. */
  trimmed: boolean
  /** A Windows device name, prefixed with `_`. */
  reserved: boolean
  /** Cut to fit the byte cap. */
  truncated: boolean
  /** Nothing usable was left, so the fallback name was used. */
  fallback: boolean
}

export interface FilenameResult {
  name: string
  changed: boolean
  changes: FilenameChanges
}

// The union of what Windows, macOS and Linux refuse: Windows' printable set,
// `/` (everywhere) and the C0 controls plus DEL. \p{Cc} also takes the C1
// controls, which are legal but invisible and never what anyone meant to
// type. Unpaired surrogates have no UTF-8 encoding at all -- TextEncoder would
// silently write U+FFFD.
const FORBIDDEN =
  /[/\\:*?"<>|\p{Cc}]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu

// Windows resolves these to devices whatever the extension (`con.txt`, and
// even `con.tar.gz`), and ignores spaces before the dot. The superscript
// digits are on Microsoft's list too.
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])$/i

// An extension is only worth preserving through truncation if it looks like
// one; the text after the last dot of a long sentence is not.
const MAX_EXT_BYTES = 32

const encoder = new TextEncoder()
const byteLength = (s: string): number => encoder.encode(s).length

let segmenter: Intl.Segmenter | undefined
function graphemes(text: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

export function isReservedFilename(name: string): boolean {
  const dot = name.indexOf('.')
  const base = dot === -1 ? name : name.slice(0, dot)
  return RESERVED.test(base.trimEnd())
}

/** Windows drops trailing dots and spaces, so `a.` and `a` would collide. */
function stripTrailing(name: string): string {
  return name.replace(/[\s.]+$/u, '')
}

/**
 * Longest prefix of `text` within `budget` UTF-8 bytes, cut at a grapheme
 * boundary so an accent or a ZWJ emoji is never split. Falls back to code
 * points for a single cluster bigger than the budget; iterating by code point
 * means a surrogate pair is never split either way.
 */
function fitBytes(text: string, budget: number): string {
  let out = ''
  let used = 0
  for (const g of graphemes(text)) {
    const n = byteLength(g)
    if (used + n > budget) {
      if (out === '') {
        for (const cp of g) {
          const m = byteLength(cp)
          if (used + m > budget) break
          out += cp
          used += m
        }
      }
      break
    }
    out += g
    used += n
  }
  return out
}

function splitExtension(name: string): [stem: string, ext: string] {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return [name, '']
  const ext = name.slice(dot)
  if (/\s/u.test(ext) || byteLength(ext) > MAX_EXT_BYTES) return [name, '']
  return [name.slice(0, dot), ext]
}

function truncate(name: string, max: number): string {
  const [stem, ext] = splitExtension(name)
  const extBytes = byteLength(ext)
  if (ext !== '' && extBytes < max) {
    const cut = stripTrailing(fitBytes(stem, max - extBytes))
    if (cut !== '') return cut + ext
  }
  return stripTrailing(fitBytes(name, max))
}

/**
 * Make a filename that is valid on Windows, macOS and Linux at once, and say
 * what had to change. Never throws and never returns '', '.' or '..'.
 */
export function safeFilename(input: string, options: Partial<FilenameOptions> = {}): FilenameResult {
  const opts = { ...DEFAULT_FILENAME_OPTIONS, ...options }
  const max = Number.isFinite(opts.maxBytes)
    ? Math.min(MAX_FILENAME_BYTES, Math.max(MIN_FILENAME_BYTES, Math.floor(opts.maxBytes)))
    : MAX_FILENAME_BYTES
  // The replacement is a closed set today, but a caller passing something
  // else must not be able to smuggle a forbidden character back in.
  const replacement = opts.replacement.replace(FORBIDDEN, '')

  const changes: FilenameChanges = {
    removedChars: 0,
    trimmed: false,
    reserved: false,
    truncated: false,
    fallback: false,
  }

  let name = input.replace(FORBIDDEN, () => {
    changes.removedChars++
    return replacement
  })

  // Leading dots are left alone: they make a dotfile, which is legal
  // everywhere. Trailing ones are not, and `.` / `..` reduce to '' here.
  const stripped = stripTrailing(name.trim())
  if (stripped !== name) changes.trimmed = true
  name = stripped

  if (name === '') {
    changes.fallback = true
    name = FALLBACK_FILENAME
  }

  if (isReservedFilename(name)) {
    changes.reserved = true
    name = `_${name}`
  }

  if (byteLength(name) > max) {
    changes.truncated = true
    name = truncate(name, max)
    // A long run of dots and spaces can cut down to nothing once the
    // trailing ones are stripped.
    if (name === '') {
      changes.fallback = true
      name = FALLBACK_FILENAME
    }
    // Cutting can only create a device name from scratch under a tiny cap,
    // but if it does, prefix it and make room for the prefix.
    if (isReservedFilename(name)) {
      changes.reserved = true
      name = truncate(`_${name}`, max)
    }
  }

  return { name, changed: name !== input, changes }
}
