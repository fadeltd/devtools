import { expose, transfer } from 'comlink'
import {
  formatTable,
  inferColumnTypes,
  parseCsv,
  type ColumnType,
  type CsvIssue,
  type CsvOutputFormat,
  type CsvTable,
  type Delimiter,
} from '@fadeltd/devtools-core/csv'

export type CsvFormat = 'table' | CsvOutputFormat

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
}

let cache: { text: string; delimiter: CsvRunInput['delimiter']; header: boolean; table: CsvTable; types: ColumnType[] } | undefined

/** Switching output format should not re-parse 10 MB, so keep the last parse. */
function parse(input: CsvRunInput) {
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
    const { table, types } = parse(input)
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
    }
    return transfer(result, [packed.offsets.buffer])
  },
}

export type CsvApi = typeof api

expose(api)
