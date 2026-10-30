/** Bytes per hex-dump row, as in `xxd` and `hexdump -C`. */
export const HEX_ROW_BYTES = 16

/** One formatted row of a hex dump, split so a UI can style each column. */
export interface HexRow {
  /** Offset of the row's first byte: 8 hex digits, more past 4 GB. */
  offset: string
  /** Bytes 0-7 and 8-15 as `00 11 22 …`, each padded to 23 columns so a short last row still lines up. */
  hex: [string, string]
  /** Printable ASCII as itself, everything else as `.`. */
  ascii: string
  /** How many bytes the row holds: 16, or fewer on the last row. */
  length: number
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))
const ASCII = Array.from({ length: 256 }, (_, i) => (i >= 0x20 && i < 0x7f ? String.fromCharCode(i) : '.'))
const GROUP_WIDTH = 23

/** Rows needed for `byteLength` bytes. */
export function hexRowCount(byteLength: number): number {
  return Math.ceil(byteLength / HEX_ROW_BYTES)
}

/**
 * Row `rowIndex` of the dump of `bytes`. Cheap enough to call per visible row,
 * so a virtualised view never formats more than it shows.
 */
export function hexRow(bytes: Uint8Array, rowIndex: number): HexRow {
  const start = rowIndex * HEX_ROW_BYTES
  const end = Math.min(start + HEX_ROW_BYTES, bytes.length)
  let left = ''
  let right = ''
  let ascii = ''
  for (let i = start; i < end; i++) {
    const b = bytes[i]!
    if (i - start < 8) left += left === '' ? HEX[b] : ` ${HEX[b]}`
    else right += right === '' ? HEX[b] : ` ${HEX[b]}`
    ascii += ASCII[b]
  }
  return {
    offset: start.toString(16).padStart(8, '0'),
    hex: [left.padEnd(GROUP_WIDTH, ' '), right.padEnd(GROUP_WIDTH, ' ')],
    ascii,
    length: Math.max(0, end - start),
  }
}

/** A row as one line: `00000000  00 11 … 77  88 … ff  |........|`. */
export function formatHexRow(row: HexRow): string {
  return `${row.offset}  ${row.hex[0]}  ${row.hex[1]}  |${row.ascii}|`
}

/**
 * Rows `[fromRow, toRow)` as newline-joined lines, offsets absolute. Lets a
 * caller build a dump of a large input chunk by chunk instead of as one string.
 */
export function hexDumpRows(bytes: Uint8Array, fromRow: number, toRow: number): string {
  const end = Math.min(toRow, hexRowCount(bytes.length))
  const lines: string[] = []
  for (let r = Math.max(0, fromRow); r < end; r++) lines.push(formatHexRow(hexRow(bytes, r)))
  return lines.join('\n')
}

/** Compact hex dump, for the "this isn't UTF-8" escape hatch. */
export function hexDump(bytes: Uint8Array, maxBytes = 4096): string {
  const limit = Math.min(bytes.length, maxBytes)
  const dump = hexDumpRows(bytes.subarray(0, limit), 0, hexRowCount(limit))
  if (bytes.length <= limit) return dump
  const more = `… ${bytes.length - limit} more bytes`
  return dump === '' ? more : `${dump}\n${more}`
}
