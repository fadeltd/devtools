import { expose, transfer } from 'comlink'
import {
  formatTable,
  inferColumnTypes,
  parseCsv,
  toDelimited,
  toHtmlTable,
  type ColumnType,
  type CsvIssue,
  type CsvOutputFormat,
  type CsvTable,
  type Delimiter,
} from '@fadeltd/devtools-core/csv'

import { RICH_CELL_LIMIT } from './limits'

export type CsvFormat = 'table' | CsvOutputFormat

/** The two halves of a rich copy: an HTML table, and TSV for plain-text targets. */
export interface RichTable {
  html: string
  text: string
}

export interface CsvRunInput {
  text: string
  delimiter: Delimiter | 'auto'
  header: boolean
  format: CsvFormat
}

export interface CsvRunResult {
  format: CsvFormat
  delimiter: Delimiter
  detected: boolean
  bom: boolean
  header: string[] | null
  columns: number
  rowCount: number
  blankLines: number
  issues: CsvIssue[]
  issueCount: number
  types: ColumnType[]
  /**
   * Table view only: every data cell concatenated, row-major, with `offsets`
   * marking where each starts (`rowCount * columns + 1` entries). One string
   * and one buffer cross back to the page instead of a million small strings,
   * whose structured clone would block the main thread for longer than the
   * parse itself. The grid slices out only the cells it is drawing.
   */
  cells: string
  offsets: Uint32Array
  /** Every format except the table. */
  output: string
  /**
   * Table and Markdown views only, and only up to `RICH_CELL_LIMIT` cells:
   * built here so it is ready when the click arrives, since the clipboard
   * write has to happen inside the click.
   */
  rich: RichTable | null
}

interface Parsed {
  text: string
  delimiter: CsvRunInput['delimiter']
  header: boolean
  table: CsvTable
  types: ColumnType[]
  /** Built on first use; `null` once it is known to be too large or empty. */
  rich?: RichTable | null
}

let cache: Parsed | undefined

/** Switching output format should not re-parse 10 MB, so keep the last parse. */
function parse(input: CsvRunInput): Parsed {
  if (
    cache !== undefined &&
    cache.delimiter === input.delimiter &&
    cache.header === input.header &&
    cache.text === input.text
  ) {
    return cache
  }
  const table = parseCsv(input.text, { delimiter: input.delimiter, header: input.header })
  const types = inferColumnTypes(table.rows, table.columns)
  cache = { text: input.text, delimiter: input.delimiter, header: input.header, table, types }
  return cache
}

function richTable(parsed: Parsed): RichTable | null {
  if (parsed.rich !== undefined) return parsed.rich
  const { table, types } = parsed
  const cells = (table.rows.length + (table.header === null ? 0 : 1)) * table.columns
  let rich: RichTable | null = null
  if (cells > 0 && cells <= RICH_CELL_LIMIT) {
    const html = toHtmlTable(table, types)
    if (html !== '') rich = { html, text: toDelimited(table, '\t') }
  }
  parsed.rich = rich
  return rich
}

function pack(table: CsvTable): { cells: string; offsets: Uint32Array } {
  const { rows, columns } = table
  const offsets = new Uint32Array(rows.length * columns + 1)
  const parts: string[] = []
  let at = 0
  let k = 0
  for (const row of rows) {
    for (let c = 0; c < columns; c++) {
      const v = row[c] ?? ''
      parts.push(v)
      offsets[k++] = at
      at += v.length
    }
  }
  offsets[k] = at
  return { cells: parts.join(''), offsets }
}

/**
 * Off the main thread because a 10 MB paste takes a few hundred ms to parse
 * and format on a phone, and that would land on every keystroke.
 */
const api = {
  run(input: CsvRunInput): CsvRunResult {
    const parsed = parse(input)
    const { table, types } = parsed
    const packed =
      input.format === 'table' ? pack(table) : { cells: '', offsets: new Uint32Array(0) }
    const result: CsvRunResult = {
      format: input.format,
      delimiter: table.delimiter,
      detected: table.detected,
      bom: table.bom,
      header: table.header,
      columns: table.columns,
      rowCount: table.rows.length,
      blankLines: table.blankLines,
      issues: table.issues,
      issueCount: table.issueCount,
      types,
      cells: packed.cells,
      offsets: packed.offsets,
      output: input.format === 'table' ? '' : formatTable(table, input.format, types),
      rich: input.format === 'table' || input.format === 'markdown' ? richTable(parsed) : null,
    }
    return transfer(result, [packed.offsets.buffer])
  },
}

export type CsvApi = typeof api

expose(api)
