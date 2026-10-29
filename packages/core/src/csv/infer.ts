export type ColumnType = 'number' | 'boolean' | 'date' | 'text' | 'empty'

// Plain decimal or scientific, with an optional sign.
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
// `1,50` (European decimal comma) and `1,234,567.89` (grouped). As a hint,
// "number" is right either way; which one it is would be a guess.
const DECIMAL_COMMA = /^[+-]?\d+,\d+$/
const GROUPED = /^[+-]?\d{1,3}(?:[, ]\d{3})+(?:\.\d+)?$/
const BOOLEAN = /^(?:true|false|yes|no)$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/
// 15/01/2024, 1.5.24, 01-15-2024, optionally with a time.
const DMY_DATE = /^\d{1,2}[/.-]\d{1,2}[/.-](?:\d{2}|\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/
const YMD_SLASH = /^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/

function isNumber(v: string): boolean {
  return NUMBER.test(v) || DECIMAL_COMMA.test(v) || GROUPED.test(v)
}

function isDate(v: string): boolean {
  return ISO_DATE.test(v) || DMY_DATE.test(v) || YMD_SLASH.test(v)
}

/** What one non-empty value looks like. */
export function valueType(value: string): Exclude<ColumnType, 'empty'> {
  const v = value.trim()
  if (isNumber(v)) return 'number'
  if (BOOLEAN.test(v)) return 'boolean'
  if (isDate(v)) return 'date'
  return 'text'
}

export const TYPE_SAMPLE_ROWS = 1000

/**
 * A per-column hint: the one type every non-empty sampled cell agrees on, or
 * `text` when they disagree. Empty cells are ignored, since a gap in a number
 * column is still a number column. Only the first `sample` rows are read: it is
 * a hint for the header, and a 10 MB file should not pay a regex per cell.
 */
export function inferColumnTypes(
  rows: readonly (readonly string[])[],
  columns: number,
  sample = TYPE_SAMPLE_ROWS,
): ColumnType[] {
  const types: ColumnType[] = Array.from({ length: columns }, () => 'empty')
  const limit = Math.min(rows.length, sample)
  for (let c = 0; c < columns; c++) {
    let t: ColumnType = 'empty'
    for (let r = 0; r < limit; r++) {
      const cell = rows[r]![c] ?? ''
      if (cell.trim() === '') continue
      const vt = valueType(cell)
      if (t === 'empty') t = vt
      else if (t !== vt) {
        t = 'text'
        break
      }
      if (t === 'text') break
    }
    types[c] = t
  }
  return types
}
