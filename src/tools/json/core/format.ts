export type Indent = 2 | 4 | 'tab'

export interface FormatOptions {
  indent: Indent
  sortKeys: boolean
}

function indentValue(indent: Indent): string | number {
  return indent === 'tab' ? '\t' : indent
}

/** Deep key sort. Never reorders arrays — their order is data. */
export function sortKeysDeep(value: unknown, cmp: (a: string, b: string) => number): unknown {
  if (Array.isArray(value)) return value.map((v) => sortKeysDeep(v, cmp))
  if (value === null || typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>)
  return Object.fromEntries(
    entries.toSorted(([a], [b]) => cmp(a, b)).map(([k, v]) => [k, sortKeysDeep(v, cmp)]),
  )
}

const keyCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'variant' }).compare

export function formatValue(value: unknown, o: FormatOptions): string {
  const prepared = o.sortKeys ? sortKeysDeep(value, keyCollator) : value
  return JSON.stringify(prepared, null, indentValue(o.indent))
}

export function minifyValue(value: unknown, o: { sortKeys: boolean }): string {
  const prepared = o.sortKeys ? sortKeysDeep(value, keyCollator) : value
  return JSON.stringify(prepared)
}

/** Wrap a string as a JSON string literal, for pasting into code. */
export function escapeAsJsonString(s: string, o: { ascii: boolean }): string {
  let out = JSON.stringify(s)
  if (o.ascii) {
    out = out.replace(/[\u007f-￿]/g, (ch) => {
      const code = ch.codePointAt(0)!
      return `\\u${code.toString(16).padStart(4, '0')}`
    })
  }
  return out
}

/** Read a JSON string literal (with or without surrounding quotes). */
export function unescapeJsonString(s: string): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = s.trim()
  const quoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
  const candidate = quoted ? trimmed : JSON.stringify(trimmed).slice(0, 1) + trimmed + '"'
  try {
    const value = JSON.parse(quoted ? trimmed : candidate) as unknown
    if (typeof value !== 'string') return { ok: false, message: 'Not a JSON string' }
    return { ok: true, value }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** Wrap NDJSON lines into a single JSON array. */
export function ndjsonToArray(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  return `[\n${lines.join(',\n')}\n]`
}

export interface NumberIssue {
  /**
   * 'precision' -- the VALUE changes, i.e. real data corruption.
   * 'reformatted' -- the value survives exactly, but JSON.stringify prints a
   * different digit sequence, so a byte-exact round-trip is still broken.
   */
  kind: 'precision' | 'reformatted'
  literal: string
  printed: string
  offset: number
}

/**
 * Cheap gate before the expensive scan: on a 20MB document this is ~0ms, while
 * the full literal scan is ~315ms. Most JSON has no 16+ digit integers at all.
 */
export function mayHaveLossyNumbers(text: string): boolean {
  return /[0-9]{16,}/.test(text)
}

/**
 * Find integer literals that a JSON.parse/stringify round-trip does not
 * preserve, and say which of the two distinct problems each one is.
 *
 * The precision predicate is deliberately NOT Number.isSafeInteger, which
 * false-positives on 9007199254740992 (2^53) -- exactly representable, yet
 * reported unsafe. Comparing BigInt(literal) against BigInt(Number(literal))
 * is the exact test.
 *
 * The 'reformatted' case is easy to miss and worth reporting separately:
 * -9223372036854775808 (int64 minimum) is exactly -2^63 and loses NO precision,
 * but JS prints it as -9223372036854776000. The number is intact; the text is
 * not. That still breaks a byte-exact diff, and it looks alarming if we say
 * nothing.
 */
export function findNumberIssues(text: string, limit = 500): NumberIssue[] {
  const out: NumberIssue[] = []
  if (!mayHaveLossyNumbers(text)) return out

  const re = /-?\d{16,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null && out.length < limit) {
    const literal = m[0]
    const n = Number(literal)
    const printed = String(n)

    if (!Number.isFinite(n) || BigInt(literal) !== BigInt(n)) {
      out.push({ kind: 'precision', literal, printed, offset: m.index })
    } else if (printed !== literal) {
      out.push({ kind: 'reformatted', literal, printed, offset: m.index })
    }
  }
  return out
}
