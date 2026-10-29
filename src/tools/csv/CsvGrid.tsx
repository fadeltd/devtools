import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatCount } from '@/lib/util/bytes'
import { cn } from '@/lib/util/cn'
import type { ColumnType } from '@fadeltd/devtools-core/csv'
import type { CsvRunResult } from './csv.worker'

// Data rows are not touch targets, so they do not need 44px; a little taller
// than the 22px desktop grid keeps the 16px mobile type from touching.
const NARROW = '(max-width: 47.99rem)'
const ROW_NARROW = 28
const ROW_WIDE = 22
// JetBrains Mono advances 0.6em: 7.8px at the 13px mobile size. Using the
// larger figure everywhere costs a little slack on desktop, never clipping.
const CHAR_PX = 7.8
const CELL_PAD = 17
const MIN_CHARS = 4
const MAX_CHARS = 40
const WIDTH_SAMPLE_ROWS = 200
/** Drawing a 1 MB cell into a span would stall the grid; the start is enough. */
const MAX_CELL_CHARS = 200

const TYPE_LABEL: Record<ColumnType, string> = {
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  text: 'text',
  empty: 'empty',
}

function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function useRowHeight(): number {
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  )
  return narrow ? ROW_NARROW : ROW_WIDE
}

/** One line per cell: a newline inside a quoted field is shown, not obeyed. */
function displayCell(value: string): string {
  const head = value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS)}…` : value
  return head.replace(/\r\n|\r|\n/g, '↵')
}

function columnName(result: CsvRunResult, c: number): string {
  return result.header?.[c] ?? String(c + 1)
}

/**
 * The parsed table, virtualised in both directions: a 10 MB file is ~100k rows,
 * and a wide export can have hundreds of columns. The header (names, then the
 * type hints as a visible row rather than a hover tooltip) sticks to the top,
 * and the row numbers stick to the left.
 */
export function CsvGrid({ result }: { result: CsvRunResult }) {
  const { rowCount, columns, cells, offsets, types } = result
  const rowHeight = useRowHeight()
  const headHeight = rowHeight * 2

  const widths = useMemo(() => {
    const out: number[] = []
    const sample = Math.min(rowCount, WIDTH_SAMPLE_ROWS)
    for (let c = 0; c < columns; c++) {
      // Lengths straight from the offsets: no strings are sliced to measure.
      let chars = Math.max(columnName(result, c).length, TYPE_LABEL[types[c] ?? 'text'].length)
      for (let r = 0; r < sample; r++) {
        const i = r * columns + c
        chars = Math.max(chars, offsets[i + 1]! - offsets[i]!)
      }
      out.push(Math.round(Math.min(Math.max(chars, MIN_CHARS), MAX_CHARS) * CHAR_PX + CELL_PAD))
    }
    return out
  }, [result, rowCount, columns, offsets, types])

  const numWidth = Math.round(Math.max(formatCount(rowCount).length, 4) * CHAR_PX + CELL_PAD)

  const ragged = useMemo(
    () => new Set(result.issues.filter((i) => i.kind === 'ragged').map((i) => i.row)),
    [result.issues],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  // The rule guards React Compiler memoisation, and this build does not run the
  // compiler. TanStack Virtual is the documented exception it flags.
  // oxlint-disable-next-line react/incompatible-library
  const rows = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    // The sticky header sits in the same scroll box, above row 0.
    paddingStart: headHeight,
    overscan: 20,
  })
  const cols = useVirtualizer({
    horizontal: true,
    count: columns,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => widths[i] ?? MIN_CHARS * CHAR_PX,
    // Room for the sticky row-number column.
    paddingStart: numWidth,
    overscan: 4,
  })

  useEffect(() => {
    rows.measure()
  }, [rowHeight, rows])
  useEffect(() => {
    cols.measure()
  }, [widths, numWidth, cols])

  const totalWidth = cols.getTotalSize()
  const vcols = cols.getVirtualItems()
  const cellLine = { lineHeight: `${rowHeight - 1}px` }

  return (
    <div
      ref={scrollRef}
      role="table"
      aria-label="Parsed table"
      aria-rowcount={rowCount + 2}
      aria-colcount={columns + 1}
      className="min-h-0 flex-1 overflow-auto bg-bg font-mono text-[13px] md:text-[12px] scroll-thin"
    >
      <div className="relative" style={{ width: totalWidth, height: rows.getTotalSize() }}>
        <div
          role="rowgroup"
          className="sticky top-0 z-20 border-b border-border bg-surface"
          style={{ width: totalWidth, height: headHeight }}
        >
          <div role="row" aria-rowindex={1} className="relative" style={{ height: rowHeight }}>
            <span
              role="columnheader"
              className="sticky left-0 z-10 block h-full border-r border-border bg-surface px-2 text-right text-faint"
              style={{ width: numWidth, ...cellLine }}
            >
              #
            </span>
            {vcols.map((c) => (
              <span
                key={c.index}
                role="columnheader"
                aria-colindex={c.index + 2}
                title={columnName(result, c.index)}
                className={cn(
                  'absolute top-0 h-full truncate border-r border-border px-2 font-semibold',
                  result.header === null ? 'text-faint' : 'text-fg',
                  types[c.index] === 'number' && 'text-right',
                )}
                style={{ left: c.start, width: c.size, ...cellLine }}
              >
                {result.header === null ? c.index + 1 : displayCell(columnName(result, c.index))}
              </span>
            ))}
          </div>
          <div
            role="row"
            aria-rowindex={2}
            className="relative border-t border-border"
            style={{ height: rowHeight }}
          >
            <span
              role="columnheader"
              className="sticky left-0 z-10 block h-full border-r border-border bg-surface px-2 text-right text-[11px] text-faint"
              style={{ width: numWidth, ...cellLine }}
            >
              type
            </span>
            {vcols.map((c) => (
              <span
                key={c.index}
                role="columnheader"
                aria-colindex={c.index + 2}
                className={cn(
                  'absolute top-0 h-full truncate border-r border-border px-2 text-[11px] text-faint',
                  types[c.index] === 'number' && 'text-right',
                )}
                style={{ left: c.start, width: c.size, ...cellLine }}
              >
                {TYPE_LABEL[types[c.index] ?? 'text']}
              </span>
            ))}
          </div>
        </div>

        {rows.getVirtualItems().map((r) => {
          const base = r.index * columns
          const warn = ragged.has(r.index + 1)
          return (
            <div
              key={r.index}
              role="row"
              aria-rowindex={r.index + 3}
              className="absolute left-0 top-0 border-b border-border"
              style={{ width: totalWidth, height: rowHeight, transform: `translateY(${r.start}px)` }}
            >
              <span
                role="rowheader"
                title={warn ? 'Ragged row: see the warnings above' : undefined}
                className={cn(
                  // Opaque: cells scroll underneath it.
                  'sticky left-0 z-10 block h-full border-r border-l-2 border-r-border bg-bg px-2 text-right tabular-nums',
                  warn ? 'border-l-warn text-warn' : 'border-l-transparent text-faint',
                )}
                style={{ width: numWidth, ...cellLine }}
              >
                {formatCount(r.index + 1)}
              </span>
              {vcols.map((c) => {
                const i = base + c.index
                const value = cells.slice(offsets[i], offsets[i + 1])
                return (
                  <span
                    key={c.index}
                    role="cell"
                    aria-colindex={c.index + 2}
                    className={cn(
                      // Not `truncate`: that implies nowrap, and leading spaces are data.
                      'absolute top-0 h-full overflow-hidden text-ellipsis whitespace-pre border-r border-border px-2 text-fg',
                      types[c.index] === 'number' && 'text-right tabular-nums',
                    )}
                    style={{ left: c.start, width: c.size, ...cellLine }}
                  >
                    {displayCell(value)}
                  </span>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
