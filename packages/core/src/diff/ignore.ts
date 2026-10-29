/**
 * The Diff tool's "ignore" options, expressed as comparison keys.
 *
 * A key never replaces the text. The engine diffs the keys but maps every
 * result back through the *original* tokens, so offsets and the displayed
 * document are untouched. Keys rather than comparator callbacks so each token
 * is normalised once, not once per comparison inside Myers.
 */
export interface IgnoreOptions {
  /** Ignore every whitespace difference, like `git diff -w`. */
  whitespace: boolean
  /** Compare case-insensitively. */
  case: boolean
  /** Ignore leading/trailing whitespace on each line, including CR and the line break. */
  trim: boolean
}

export const NO_IGNORE: IgnoreOptions = { whitespace: false, case: false, trim: false }

export interface Keys {
  line: (line: string) => string
  word: (token: string) => string
}

const WHITESPACE = /\s+/g
const ALL_WHITESPACE = /^\s+$/

/** Comparison keys for the options, or `undefined` to compare tokens exactly. */
export function keysFor(o: IgnoreOptions): Keys | undefined {
  if (!o.whitespace && !o.case && !o.trim) return undefined
  const fold = o.case ? (s: string) => s.toLowerCase() : (s: string) => s
  const line = o.whitespace
    ? (s: string) => fold(s.replace(WHITESPACE, ''))
    : o.trim
      ? (s: string) => fold(s.trim())
      : fold
  // Line breaks stay distinct from spaces: joining or splitting a line is a
  // real change, and without it that run would have nothing to highlight.
  const word = o.whitespace
    ? (s: string) => (s === '\n' || s === '\r\n' ? '\n' : ALL_WHITESPACE.test(s) ? ' ' : fold(s))
    : fold
  return { line, word }
}

/** "whitespace, case" -- for the "identical (ignoring …)" badge. */
export function ignoreLabel(o: IgnoreOptions): string | null {
  const parts: string[] = []
  if (o.whitespace) parts.push('whitespace')
  if (o.case) parts.push('case')
  if (o.trim) parts.push('leading/trailing whitespace')
  return parts.length > 0 ? parts.join(', ') : null
}
