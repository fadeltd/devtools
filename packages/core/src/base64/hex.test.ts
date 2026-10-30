import { describe, expect, it } from 'vitest'
import { formatHexRow, hexDump, hexDumpRows, hexRow, hexRowCount, HEX_ROW_BYTES } from './hex.ts'

const ascending = (n: number) => Uint8Array.from({ length: n }, (_, i) => i & 0xff)

describe('hexRow', () => {
  it('formats a full row into offset, two groups and ascii', () => {
    const bytes = new TextEncoder().encode('Hello, world! 0123')
    const row = hexRow(bytes, 0)
    expect(row.offset).toBe('00000000')
    expect(row.hex).toEqual(['48 65 6c 6c 6f 2c 20 77', '6f 72 6c 64 21 20 30 31'])
    expect(row.ascii).toBe('Hello, world! 01')
    expect(row.length).toBe(16)
  })

  it('pads a partial last row so its columns line up', () => {
    const bytes = ascending(16 + 3)
    const row = hexRow(bytes, 1)
    expect(row.offset).toBe('00000010')
    expect(row.hex[0]).toBe('10 11 12'.padEnd(23, ' '))
    expect(row.hex[1]).toBe(' '.repeat(23))
    expect(row.ascii).toBe('...')
    expect(row.length).toBe(3)
    expect(formatHexRow(row)).toHaveLength(formatHexRow(hexRow(bytes, 0)).length - 13)
  })

  it('pads a row that ends inside the second group', () => {
    const row = hexRow(ascending(10), 0)
    expect(row.hex[1]).toBe('08 09'.padEnd(23, ' '))
  })

  it('shows only printable ASCII and dots for the rest', () => {
    const row = hexRow(new Uint8Array([0x00, 0x1f, 0x20, 0x41, 0x7e, 0x7f, 0x80, 0xff]), 0)
    expect(row.ascii).toBe('.. A~...')
  })

  it('uses absolute offsets and widens past 32 bits', () => {
    expect(hexRow(ascending(64), 3).offset).toBe('00000030')
    // A row index past 4 GB: the offset is not truncated, the row is just empty.
    const far = hexRow(new Uint8Array(0), 0x10000000)
    expect(far.offset).toBe('100000000')
    expect(far.length).toBe(0)
  })
})

describe('hexRowCount', () => {
  it('rounds up', () => {
    expect(hexRowCount(0)).toBe(0)
    expect(hexRowCount(1)).toBe(1)
    expect(hexRowCount(HEX_ROW_BYTES)).toBe(1)
    expect(hexRowCount(HEX_ROW_BYTES + 1)).toBe(2)
  })
})

describe('hexDumpRows', () => {
  it('joins a range of rows and clamps it to the data', () => {
    const bytes = ascending(40)
    expect(hexDumpRows(bytes, 1, 2)).toBe(formatHexRow(hexRow(bytes, 1)))
    expect(hexDumpRows(bytes, 0, 99).split('\n')).toHaveLength(3)
    expect(hexDumpRows(bytes, 5, 9)).toBe('')
  })

  it('builds the same dump in chunks as in one go', () => {
    const bytes = ascending(1000)
    const whole = hexDumpRows(bytes, 0, hexRowCount(bytes.length))
    const chunked = [hexDumpRows(bytes, 0, 20), hexDumpRows(bytes, 20, 40), hexDumpRows(bytes, 40, 63)].join('\n')
    expect(chunked).toBe(whole)
  })
})

describe('hexDump', () => {
  it('keeps the classic layout', () => {
    expect(hexDump(new TextEncoder().encode('AB\n'))).toBe(
      `00000000  41 42 0a${' '.repeat(15)}  ${' '.repeat(23)}  |AB.|`,
    )
  })

  it('caps the output and says how much is left', () => {
    const lines = hexDump(ascending(100), 32).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('… 68 more bytes')
  })

  it('is empty for no bytes, and only the note when the cap is zero', () => {
    expect(hexDump(new Uint8Array(0))).toBe('')
    expect(hexDump(ascending(5), 0)).toBe('… 5 more bytes')
  })
})
