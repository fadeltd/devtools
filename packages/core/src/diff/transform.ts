import { analyze, stripJsonc } from '../json/errors.ts'
import { findNumberIssues, formatValue, sortKeysDeep } from '../json/format.ts'
import { losslessSupported, parseLossless } from '../json/rawjson.ts'
import { comparatorFor } from '../list/compare.ts'
import { parseLines, serializeLines, withLines } from '../list/lines.ts'
import { defaultOp } from '../list/ops.ts'

/**
 * Rewrites applied to each side before diffing, so that two documents which
 * differ only in line order, or only in JSON key order and formatting, compare
 * as identical.
 *
 * These are transforms, not diff options: they change the text that is shown,
 * which is why the UI makes both panes read-only while one is active.
 */
export type DiffTransform = 'sort-lines' | 'json'

export interface TransformOptions {
  /**
   * Keep integers a double cannot hold as their literal digits. On by default
   * where the platform supports it (`JSON.rawJSON`); ignored where it does not.
   */
  lossless?: boolean
}

export type TransformResult =
  | {
      ok: true
      text: string
      /** Things the reader should know about the rewritten text, e.g. rounded numbers. */
      notes: string[]
    }
  | { ok: false; error: string }

export function transformForDiff(
  text: string,
  kind: DiffTransform,
  options: TransformOptions = {},
): TransformResult {
  switch (kind) {
    case 'sort-lines':
      return sortLines(text)
    case 'json':
      return normalizeJson(text, (options.lossless ?? true) && losslessSupported)
  }
}

type Compare = (a: string, b: string) => number

let lineOrder: Compare | null = null

/**
 * The List tool's default sort (natural, case-insensitive), with a code-point
 * tie-break. The collator calls `a` and `A`, or `1` and `01`, equal, and a
 * stable sort then keeps them in input order -- so the same lines in a
 * different order would sort to different text and show a spurious change.
 * The tie-break makes the output depend only on the multiset of lines.
 *
 * Built on first use: constructing a collator is not free, and the package is
 * side-effect free.
 */
function compareLines(): Compare {
  if (lineOrder !== null) return lineOrder
  const op = defaultOp('sort')
  if (op.kind !== 'sort') throw new Error('defaultOp("sort") is not a sort')
  const natural = comparatorFor(op)
  lineOrder = (a, b) => natural(a, b) || (a < b ? -1 : a > b ? 1 : 0)
  return lineOrder
}

let keyOrder: Compare | null = null

/**
 * The JSON tool's key order (`withSortedKeys`: natural, case-sensitive), with
 * the same code-point tie-break as lines: numeric collation calls `"02"` and
 * `"2"` equal, and their input order must not leak into the output.
 */
function compareKeys(): Compare {
  if (keyOrder !== null) return keyOrder
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'variant' }).compare
  keyOrder = (a, b) => natural(a, b) || (a < b ? -1 : a > b ? 1 : 0)
  return keyOrder
}

function sortLines(text: string): TransformResult {
  const doc = parseLines(text)
  const notes: string[] = []
  // There is no single faithful ending for mixed input; serializeLines uses LF.
  if (doc.eol === 'mixed') notes.push('Mixed line endings were normalised to LF.')
  const sorted = withLines(doc, doc.lines.toSorted(compareLines()))
  return { ok: true, text: serializeLines(sorted), notes }
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

function normalizeJson(text: string, lossless: boolean): TransformResult {
  // An empty side stays empty: comparing a document against nothing is normal.
  if (text.trim() === '') return { ok: true, text, notes: [] }

  // Lenient, so a config file with comments (tsconfig.json) still compares.
  const analysis = analyze(text, { lenient: true })
  if (analysis.value === undefined) {
    const issue = analysis.issues[0]
    const where = issue === undefined ? '' : ` at line ${issue.line}, column ${issue.column}`
    const message = issue?.message ?? 'Could not parse JSON'
    const ndjson = analysis.ndjson === null ? '' : ' (it looks like NDJSON: one value per line)'
    return { ok: false, error: `${message}${where}${ndjson}` }
  }

  const notes: string[] = []
  const strict = analysis.flavor === 'jsonc' ? stripJsonc(text) : text
  if (analysis.flavor === 'jsonc') notes.push('Comments and trailing commas were removed.')

  // Same approach as the JSON tool: only when the cheap number scan trips,
  // re-parse keeping those literals as written.
  let value: unknown = analysis.value
  const issues = findNumberIssues(strict, Number.POSITIVE_INFINITY)
  if (issues.length > 0) {
    if (lossless) {
      value = parseLossless(strict)
    } else {
      const rounded = issues.filter((n) => n.kind === 'precision').length
      const reprinted = issues.length - rounded
      if (rounded > 0) {
        notes.push(
          `${plural(rounded, 'number is', 'numbers are')} too large for this browser to keep exactly and may have been rounded.`,
        )
      }
      if (reprinted > 0) {
        notes.push(`${plural(reprinted, 'number is', 'numbers are')} printed differently, with the same value.`)
      }
    }
  }

  // A final newline, as a file would have, so a copied patch does not end in
  // "\ No newline at end of file".
  const canonical = sortKeysDeep(value, compareKeys())
  return { ok: true, text: formatValue(canonical, { indent: 2, sortKeys: false }) + '\n', notes }
}
