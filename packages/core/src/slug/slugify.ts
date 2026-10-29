export type SlugSeparator = '-' | '_' | '.'

export interface SlugOptions {
  separator: SlugSeparator
  lowercase: boolean
  /** Maximum length in code points. 0 means no limit. */
  maxLength: number
  /** Fold to a-z0-9. Off keeps any Unicode letter or number, for CJK slugs. */
  ascii: boolean
  /** Spell `&` as `and` instead of dropping it. */
  ampersand: boolean
}

export const DEFAULT_SLUG_OPTIONS: SlugOptions = {
  separator: '-',
  lowercase: true,
  maxLength: 0,
  ascii: true,
  ampersand: true,
}

/**
 * Letters that NFKD leaves whole, because they are letters in their own right
 * rather than a base letter plus an accent. Without this table `Straße` would
 * slug to `strae` and `Łódź` to `odz`.
 */
const TRANSLITERATE: Readonly<Record<string, string>> = {
  ß: 'ss', ẞ: 'SS',
  æ: 'ae', Æ: 'AE',
  œ: 'oe', Œ: 'OE',
  ø: 'o', Ø: 'O',
  đ: 'd', Đ: 'D',
  ð: 'd', Ð: 'D',
  ł: 'l', Ł: 'L',
  þ: 'th', Þ: 'TH',
  ı: 'i',
  ħ: 'h', Ħ: 'H',
  ŧ: 't', Ŧ: 'T',
  ŋ: 'ng', Ŋ: 'NG',
  ĸ: 'k',
  ƒ: 'f',
}

const TRANSLITERATE_RE = new RegExp(`[${Object.keys(TRANSLITERATE).join('')}]`, 'gu')

// Typographic and modifier apostrophes as well as the ASCII one: `don’t` from a
// word processor must slug the same as `don't`.
const APOSTROPHES = /['‘’ʼ]/gu

const ASCII_WORD = /[A-Za-z0-9]+/g
// A word starts with a letter or number and may carry combining marks after
// it. Marks are needed for scripts like Devanagari, but a mark with nothing
// before it -- notably the U+FE0F after an emoji -- must not become a word.
const UNICODE_WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu

/**
 * Insert a space at camelCase boundaries so they split like any other word
 * break. The second rule keeps an acronym together (`HTTPServer` -> `HTTP
 * Server`), and its lookahead keeps a plural acronym whole (`APIs`, `IDs`).
 */
function splitCamel(text: string): string {
  return text
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}(?!s(?!\p{Ll}))\p{Ll})/gu, '$1 $2')
}

function foldAscii(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(TRANSLITERATE_RE, (ch) => TRANSLITERATE[ch] ?? '')
}

let segmenter: Intl.Segmenter | undefined
function graphemes(text: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

function codePointLength(text: string): number {
  let n = 0
  for (const _ of text) n++
  return n
}

/** Cut one word to `max` code points, preferring a grapheme boundary. */
function cutWord(word: string, max: number): string {
  let out = ''
  let used = 0
  for (const g of graphemes(word)) {
    const len = codePointLength(g)
    if (used + len > max) break
    out += g
    used += len
  }
  // A single cluster longer than the whole budget: code points are the best
  // we can do.
  return out !== '' ? out : Array.from(word).slice(0, max).join('')
}

/**
 * Keep whole words while they fit. Only when the first word alone is over the
 * limit is a word cut, since an empty slug would be worse than a clipped one.
 */
function truncateWords(words: string[], sep: string, max: number): string[] {
  const kept: string[] = []
  let used = 0
  for (const word of words) {
    const add = (kept.length > 0 ? sep.length : 0) + codePointLength(word)
    if (used + add > max) break
    kept.push(word)
    used += add
  }
  if (kept.length === 0 && words[0] !== undefined) return [cutWord(words[0], max)]
  return kept
}

/** The words a slug is built from, before joining. Exported for tests. */
export function slugWords(text: string, opts: Pick<SlugOptions, 'ascii' | 'ampersand'>): string[] {
  let s = text
  if (opts.ampersand) s = s.replace(/&/g, ' and ')
  s = s.replace(APOSTROPHES, '')
  // Before folding: folding turns `Æble` into `AEble`, which would then split
  // as an acronym.
  s = splitCamel(s)
  if (opts.ascii) {
    s = foldAscii(s)
    return s.match(ASCII_WORD) ?? []
  }
  return s.normalize('NFC').match(UNICODE_WORD) ?? []
}

/**
 * Turn text into a URL slug. Never throws; text with nothing sluggable in it
 * (all emoji, all punctuation) gives an empty string, which the caller can
 * detect and explain.
 */
export function slugify(text: string, options: Partial<SlugOptions> = {}): string {
  const opts = { ...DEFAULT_SLUG_OPTIONS, ...options }
  let words = slugWords(text, opts)
  if (opts.lowercase) words = words.map((w) => w.toLowerCase())
  // Splitting on words and joining once is what collapses separator runs and
  // trims them at both ends: there is never an empty word to join.
  const max = Number.isFinite(opts.maxLength) ? Math.floor(opts.maxLength) : 0
  if (max > 0) words = truncateWords(words, opts.separator, max)
  return words.join(opts.separator)
}
