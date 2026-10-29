import type { ColumnType } from './infer.ts'
import type { Delimiter } from './parse.ts'

/** The parts of a parsed table the writers need. */
export interface TableData {
  header: readonly string[] | null
  rows: readonly (readonly string[])[]
}

export type CsvOutputFormat = 'json' | 'markdown' | 'csv' | 'tsv'

const NEEDS_QUOTE: Record<Delimiter, RegExp> = {
  ',': /[",\r\n]/,
  '\t': /["\t\r\n]/,
  ';': /[";\r\n]/,
  '|': /["|\r\n]/,
}

/**
 * Quote only when the field would not survive otherwise. A leading BOM is
 * quoted too: unquoted at the very start of the output, a reader (ours
 * included) would strip it as a byte-order mark.
 */
export function quoteField(value: string, delimiter: Delimiter): string {
  if (NEEDS_QUOTE[delimiter].test(value) || value.charCodeAt(0) === 0xfeff) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function writeRecord(record: readonly string[], delimiter: Delimiter): string {
  // A one-field record holding '' would be an empty line, which readers skip.
  if (record.length === 1 && record[0] === '') return '""'
  return record.map((v) => quoteField(v, delimiter)).join(delimiter)
}

/**
 * Re-serialise with minimal quoting. Ends with a newline, which is a line
 * terminator here, not an extra empty row.
 */
export function toDelimited(table: TableData, delimiter: Delimiter, eol: '\n' | '\r\n' = '\n'): string {
  const out: string[] = []
  if (table.header !== null) out.push(writeRecord(table.header, delimiter))
  for (const r of table.rows) out.push(writeRecord(r, delimiter))
  return out.length === 0 ? '' : out.join(eol) + eol
}

/**
 * JSON object keys for a header row. Empty names become `field3` and repeats
 * become `name_2`, because an object cannot hold two values under one key and
 * silently dropping a column is the worse outcome.
 */
export function jsonKeys(header: readonly string[]): string[] {
  const used = new Set<string>()
  return header.map((name, i) => {
    const base = name === '' ? `field${i + 1}` : name
    let key = base
    for (let k = 2; used.has(key); k++) key = `${base}_${k}`
    used.add(key)
    return key
  })
}

/**
 * Values stay strings: `007`, `1,50` and 20-digit IDs must come out exactly as
 * they went in. Objects are written by hand rather than via JSON.stringify of
 * an object, which would reorder integer-like keys (`2023`, `2024`) ahead of
 * the rest and so scramble the column order.
 */
export function toJson(table: TableData, indent = 2): string {
  if (table.rows.length === 0) return '[]'
  const pad = ' '.repeat(indent)
  const nl = indent > 0 ? '\n' : ''
  const sep = indent > 0 ? ': ' : ':'
  const out: string[] = []
  if (table.header === null) {
    for (const r of table.rows) out.push(pad + JSON.stringify(r))
  } else {
    const keys = jsonKeys(table.header).map((k) => JSON.stringify(k))
    for (const r of table.rows) {
      const fields = keys.map((k, i) => pad + pad + k + sep + JSON.stringify(r[i] ?? ''))
      out.push(`${pad}{${nl}${fields.join(`,${nl}`)}${nl}${pad}}`)
    }
  }
  return `[${nl}${out.join(`,${nl}`)}${nl}]`
}

function markdownCell(value: string): string {
  // A pipe would end the cell and a newline would end the table. Backslash
  // first, so the escape we add is not itself re-escaped by a later pass.
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replace(/\r\n|\r|\n/g, '<br>')
}

/** Padding stops here, so one long cell does not widen every row of the table. */
const MAX_PAD = 40

/**
 * A GitHub-flavoured Markdown table. Markdown requires a header row, so with
 * the header off the columns are named `Column 1`, `Column 2`, …. Number
 * columns are right-aligned when `types` is given.
 */
export function toMarkdown(table: TableData, types: readonly ColumnType[] = []): string {
  const columns = Math.max(table.header?.length ?? 0, ...table.rows.slice(0, 1).map((r) => r.length))
  if (columns === 0) return ''
  const head = (table.header ?? Array.from({ length: columns }, (_, i) => `Column ${i + 1}`)).map(
    markdownCell,
  )
  const body = table.rows.map((r) => r.map(markdownCell))

  const widths = head.map((h) => Math.min(Math.max(h.length, 3), MAX_PAD))
  for (const r of body) {
    for (let c = 0; c < columns; c++) {
      const len = r[c]?.length ?? 0
      if (len > widths[c]! && widths[c]! < MAX_PAD) widths[c] = Math.min(len, MAX_PAD)
    }
  }

  const line = (cells: readonly string[]) =>
    `| ${widths.map((w, c) => {
      const v = cells[c] ?? ''
      return types[c] === 'number' ? v.padStart(w) : v.padEnd(w)
    }).join(' | ')} |`

  const rule = `| ${widths
    .map((w, c) => (types[c] === 'number' ? `${'-'.repeat(w - 1)}:` : '-'.repeat(w)))
    .join(' | ')} |`

  return [line(head), rule, ...body.map(line)].join('\n') + '\n'
}

/** One entry point for the text outputs. */
export function formatTable(table: TableData, format: CsvOutputFormat, types: readonly ColumnType[] = []): string {
  switch (format) {
    case 'json':
      return toJson(table)
    case 'markdown':
      return toMarkdown(table, types)
    case 'csv':
      return toDelimited(table, ',')
    case 'tsv':
      return toDelimited(table, '\t')
  }
}
