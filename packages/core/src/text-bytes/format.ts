export type ByteFormat = 'binary' | 'hex' | 'decimal' | 'octal'
export type Separator = 'space' | 'none' | 'comma' | 'newline'
/** Hex only. `\x` with no separator gives a string literal C, Python and JS all accept. */
export type HexPrefix = 'none' | '0x' | '\\x'

export interface FormatOptions {
  format: ByteFormat
  separator: Separator
  /** Hex digits only: the `0x` / `\x` prefix stays lowercase, as compilers expect. */
  uppercase: boolean
  prefix: HexPrefix
  /** Start a new line every N bytes. 0 keeps everything on one line; ignored for the newline separator. */
  perLine: number
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  format: 'binary',
  separator: 'space',
  uppercase: false,
  prefix: 'none',
  perLine: 0,
}

const SEPARATORS: Record<Separator, string> = { space: ' ', none: '', comma: ', ', newline: '\n' }

/** One string per byte value, so the hot loop is a table lookup and nothing else. */
function cellTable(o: FormatOptions): string[] {
  const table: string[] = []
  for (let b = 0; b < 256; b++) {
    switch (o.format) {
      case 'binary':
        table.push(b.toString(2).padStart(8, '0'))
        break
      case 'hex': {
        const digits = b.toString(16).padStart(2, '0')
        table.push((o.prefix === 'none' ? '' : o.prefix) + (o.uppercase ? digits.toUpperCase() : digits))
        break
      }
      case 'octal':
        // Always three digits: unpadded octal is unreadable back without a separator.
        table.push(b.toString(8).padStart(3, '0'))
        break
      case 'decimal':
        // Without a separator, "72101" is unparseable; zero-padding to three
        // digits ("072101") is what makes the contiguous form reversible.
        table.push(o.separator === 'none' ? String(b).padStart(3, '0') : String(b))
        break
    }
  }
  return table
}

/** Format bytes as text. Linear in the input: cells and lines are collected in arrays and joined once. */
export function renderBytes(bytes: Uint8Array, o: FormatOptions): string {
  const table = cellTable(o)
  const sep = SEPARATORS[o.separator]
  const perLine = o.separator === 'newline' ? 0 : Math.max(0, Math.floor(o.perLine))

  const join = (from: number, to: number) => {
    const cells: string[] = []
    for (let i = from; i < to; i++) cells.push(table[bytes[i]!]!)
    return cells.join(sep)
  }

  if (perLine === 0) return join(0, bytes.length)

  // A comma list keeps its trailing comma at each line end, so the output can
  // be pasted straight into a C or JS array literal.
  const lineEnd = o.separator === 'comma' ? ',\n' : '\n'
  const lines: string[] = []
  for (let start = 0; start < bytes.length; start += perLine) {
    lines.push(join(start, Math.min(start + perLine, bytes.length)))
  }
  return lines.join(lineEnd)
}
