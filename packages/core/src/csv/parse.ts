export type Delimiter = ',' | '\t' | ';' | '|'

/** In sniffing priority order for ties; see `sniffDelimiter`. */
export const DELIMITERS: readonly Delimiter[] = ['\t', ';', '|', ',']

export type CsvIssueKind =
  | 'unterminated-quote'
  | 'text-after-quote'
  | 'ragged'
  | 'duplicate-header'

export interface CsvIssue {
  kind: CsvIssueKind
  /** 1-based line in the input. */
  line: number
  /** 1-based column on that line, in UTF-16 units. */
  column: number
  /** UTF-16 offset into the input as given (BOM included), for selecting it. */
  offset: number
  /** Table row as displayed: 1-based data row, 0 for the header row. */
  row: number
  message: string
  /** Ragged rows only: the field count every row is checked against. */
  expected?: number
  /** Ragged rows only: the field count this row actually has. */
  got?: number
}

/**
 * Stored issue details are capped: a 10 MB file where every row is ragged
 * would otherwise build a million issue objects nobody reads. `issueCount`
 * still counts them all.
 */
export const MAX_ISSUES = 1000

const QUOTE = 34
const LF = 10
const CR = 13
const BOM = '﻿'

export interface Tokenized {
  records: string[][]
  issues: CsvIssue[]
  issueCount: number
  /** Empty lines that were skipped rather than read as a record. */
  blankLines: number
  /** Field count of the first record, which every later record is checked against. */
  expected: number
  /** Widest record. */
  width: number
}

interface TokenizeOpts {
  /** Stop after this many records. Used by sniffing, which only needs a sample. */
  maxRecords?: number
  /** Only affects the `row` numbers on issues. */
  header?: boolean
  /** Added to every reported offset, so offsets point into the text before the BOM was cut. */
  baseOffset?: number
}

/** Index of the next delimiter, CR or LF at or after `from`, or the end. */
function fieldEnd(text: string, from: number, d: number): number {
  const n = text.length
  let i = from
  while (i < n) {
    const c = text.charCodeAt(i)
    if (c === d || c === LF || c === CR) break
    i++
  }
  return i
}

/**
 * RFC 4180 tokenizer, single pass, linear time.
 *
 * Deliberately lenient where real files are not RFC-clean, and says so rather
 * than throwing:
 * - CRLF, LF and lone CR all end a record (old Mac exports still exist).
 * - An unterminated quote is reported at its position and then read as a
 *   literal `"`, so one stray quote cannot swallow the rest of a 10 MB file
 *   into a single cell. This stays linear: a scan that runs off the end has
 *   seen only even runs of quotes after the opener, so any later field that
 *   opens a quote closes within its own run.
 * - Text after a closing quote (`"a"b`) is kept and reported.
 * - A quote inside an unquoted field (`5'10"`) is kept as-is.
 * - Empty lines are skipped (and counted), except in a one-column file, where
 *   an empty line is a legitimately empty value.
 * - A trailing newline ends the last record; it does not start an empty one.
 */
export function tokenize(text: string, delimiter: Delimiter, opts: TokenizeOpts = {}): Tokenized {
  const maxRecords = opts.maxRecords ?? Infinity
  const header = opts.header ?? false
  const base = opts.baseOffset ?? 0
  const n = text.length
  const d = delimiter.charCodeAt(0)

  const records: string[][] = []
  const issues: CsvIssue[] = []
  let issueCount = 0
  let blankLines = 0
  let expected = -1
  let width = 0

  let pos = 0
  let line = 1
  let lineStart = 0

  const rowOf = (index: number) => (header ? index : index + 1)
  const report = (issue: CsvIssue) => {
    issueCount++
    if (issues.length < MAX_ISSUES) issues.push(issue)
  }

  while (pos < n && records.length < maxRecords) {
    const first = text.charCodeAt(pos)
    if (first === CR || first === LF) {
      if (expected === 1) records.push([''])
      else blankLines++
      pos += first === CR && text.charCodeAt(pos + 1) === LF ? 2 : 1
      line++
      lineStart = pos
      continue
    }

    const recStart = pos
    const recLine = line
    const recColumn = pos - lineStart + 1
    const record: string[] = []

    for (;;) {
      let value: string
      if (pos < n && text.charCodeAt(pos) === QUOTE) {
        const open = pos
        const openLine = line
        const openLineStart = lineStart
        let acc = ''
        let seg = pos + 1
        let i = pos + 1
        let close = -1
        while (i < n) {
          const c = text.charCodeAt(i)
          if (c === QUOTE) {
            if (text.charCodeAt(i + 1) === QUOTE) {
              // `""` is one literal quote: keep the first, skip the second.
              acc += text.slice(seg, i + 1)
              i += 2
              seg = i
              continue
            }
            close = i
            break
          }
          if (c === LF) {
            line++
            lineStart = i + 1
          } else if (c === CR && text.charCodeAt(i + 1) !== LF) {
            line++
            lineStart = i + 1
          }
          i++
        }

        if (close >= 0) {
          value = acc + text.slice(seg, close)
          pos = close + 1
          if (pos < n) {
            const c = text.charCodeAt(pos)
            if (c !== d && c !== CR && c !== LF) {
              report({
                kind: 'text-after-quote',
                line,
                column: pos - lineStart + 1,
                offset: base + pos,
                row: rowOf(records.length),
                message: 'Text after a closing quote; kept as part of the field',
              })
              const end = fieldEnd(text, pos, d)
              value += text.slice(pos, end)
              pos = end
            }
          }
        } else {
          // Rewind the line count the failed scan advanced, then re-read the
          // field as unquoted text starting at the quote itself.
          line = openLine
          lineStart = openLineStart
          report({
            kind: 'unterminated-quote',
            line,
            column: open - lineStart + 1,
            offset: base + open,
            row: rowOf(records.length),
            message: 'This quote is never closed; read it as a literal quote character',
          })
          const end = fieldEnd(text, open, d)
          value = text.slice(open, end)
          pos = end
        }
      } else {
        const end = fieldEnd(text, pos, d)
        value = text.slice(pos, end)
        pos = end
      }

      record.push(value)
      if (pos < n && text.charCodeAt(pos) === d) {
        pos++
        continue
      }
      break
    }

    if (pos < n) {
      const c = text.charCodeAt(pos)
      pos += c === CR && text.charCodeAt(pos + 1) === LF ? 2 : 1
      line++
      lineStart = pos
    }

    const index = records.length
    records.push(record)
    if (record.length > width) width = record.length
    if (expected === -1) {
      expected = record.length
    } else if (record.length !== expected) {
      const fewer = record.length < expected
      report({
        kind: 'ragged',
        line: recLine,
        column: recColumn,
        offset: base + recStart,
        row: rowOf(index),
        expected,
        got: record.length,
        message: fewer
          ? `${record.length} of ${expected} fields; padded with empty cells`
          : `${record.length} fields, expected ${expected}; the extra cells get columns of their own`,
      })
    }
  }

  return { records, issues, issueCount, blankLines, expected: Math.max(expected, 0), width }
}

export interface SniffResult {
  delimiter: Delimiter
  /** False when no candidate split the sample into two or more fields. */
  confident: boolean
}

const SNIFF_RECORDS = 50

/**
 * Pick the delimiter that gives the most consistent field count over the first
 * ~50 records, read quote-aware so a newline inside quotes does not count.
 *
 * Consistency, not field count, is what decides: in European CSV
 * (`Name;Price\nApple;1,50`) commas split every row too, but the header has a
 * different count than the rows. On a true tie, tab beats semicolon beats pipe
 * beats comma, because commas are the delimiter most likely to also occur in
 * the data (decimal commas, prose), and tabs the least.
 */
export function sniffDelimiter(text: string): SniffResult {
  const body = text.startsWith(BOM) ? text.slice(1) : text
  let best: { delimiter: Delimiter; score: number } | undefined
  for (const delimiter of DELIMITERS) {
    const { records } = tokenize(body, delimiter, { maxRecords: SNIFF_RECORDS })
    if (records.length === 0) continue
    const counts = new Map<number, number>()
    for (const r of records) counts.set(r.length, (counts.get(r.length) ?? 0) + 1)
    let mode = 0
    let modeCount = 0
    for (const [width, count] of counts) {
      if (count > modeCount || (count === modeCount && width > mode)) {
        mode = width
        modeCount = count
      }
    }
    if (mode < 2) continue
    const score = modeCount / records.length
    // Strictly greater: DELIMITERS is in tie-break order.
    if (best === undefined || score > best.score) best = { delimiter, score }
  }
  return best === undefined
    ? { delimiter: ',', confident: false }
    : { delimiter: best.delimiter, confident: true }
}

export interface CsvOptions {
  /** `'auto'` sniffs; see `sniffDelimiter`. */
  delimiter: Delimiter | 'auto'
  /** Treat the first record as column names. */
  header: boolean
}

export interface CsvTable {
  delimiter: Delimiter
  /** True when the delimiter was sniffed rather than given. */
  detected: boolean
  /** A UTF-8 BOM was present and stripped. */
  bom: boolean
  /** Column names, padded with `''` to `columns`. Null when `header` is off. */
  header: string[] | null
  /** Data rows, every one padded with `''` to `columns`. */
  rows: string[][]
  /** Width of the widest record, so no cell is ever dropped. */
  columns: number
  blankLines: number
  issues: CsvIssue[]
  issueCount: number
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = { delimiter: 'auto', header: true }

/** Parse CSV/TSV text into a rectangular table. Never throws; problems come back as `issues`. */
export function parseCsv(input: string, options: Partial<CsvOptions> = {}): CsvTable {
  const opts = { ...DEFAULT_CSV_OPTIONS, ...options }
  const bom = input.startsWith(BOM)
  const text = bom ? input.slice(1) : input
  const detected = opts.delimiter === 'auto'
  const delimiter = opts.delimiter === 'auto' ? sniffDelimiter(text).delimiter : opts.delimiter

  const tok = tokenize(text, delimiter, { header: opts.header, baseOffset: bom ? 1 : 0 })
  const columns = tok.width
  const records = tok.records
  for (const r of records) while (r.length < columns) r.push('')

  const header = opts.header ? (records.shift() ?? null) : null
  // Header problems come first, so the list reads top to bottom.
  const headerIssues: CsvIssue[] = []
  if (header !== null) {
    // Reported because JSON output has to rename them, which changes the shape
    // of every object; see `jsonKeys`.
    const seen = new Map<string, number>()
    header.forEach((name, i) => {
      if (name === '') return
      const prev = seen.get(name)
      if (prev === undefined) {
        seen.set(name, i)
        return
      }
      headerIssues.push({
        kind: 'duplicate-header',
        line: 1,
        column: 1,
        offset: bom ? 1 : 0,
        row: 0,
        message: `Column ${i + 1} repeats the name "${name}" from column ${prev + 1}`,
      })
    })
  }
  const issues =
    headerIssues.length === 0 ? tok.issues : headerIssues.concat(tok.issues).slice(0, MAX_ISSUES)
  const issueCount = tok.issueCount + headerIssues.length

  return {
    delimiter,
    detected,
    bom,
    header,
    rows: records,
    columns,
    blankLines: tok.blankLines,
    issues,
    issueCount,
  }
}
