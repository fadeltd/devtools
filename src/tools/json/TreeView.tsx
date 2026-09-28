import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { formatCount } from '@/lib/util/bytes'
import { cn } from '@/lib/util/cn'
import {
  allContainerPointers,
  countNodes,
  defaultExpanded,
  flattenTree,
  pathOf,
  toggle,
  type FlatNode,
} from './core/tree'
import { toDotPath, toJsonPointer } from './core/embedded'
import { toJqPath } from './core/paths'

// Matches the palette rows: a 44px touch target below md, the 22px code-table
// grid from DESIGN.md above it.
const NARROW = '(max-width: 47.99rem)'
const ROW_NARROW = 44
const ROW_WIDE = 22
const INDENT = 14

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

interface Expansion {
  source: unknown
  expanded: ReadonlySet<string>
  /**
   * Until the user toggles something, every new value opens with the default
   * expansion. After that their choices are kept across edits -- pointers are
   * stable as long as the keys are.
   */
  touched: boolean
  capped: boolean
}

function RowValue({ row }: { row: FlatNode }) {
  if (row.kind === 'object' || row.kind === 'array') {
    const [open, close] = row.kind === 'object' ? ['{', '}'] : ['[', ']']
    const noun = row.kind === 'object' ? 'key' : 'item'
    if (row.expanded) return <span className="shrink-0 text-faint">{open}</span>
    return (
      <span className="shrink-0 text-faint">
        {open}{' '}
        <span className="text-muted">
          {formatCount(row.childCount)} {noun}
          {row.childCount === 1 ? '' : 's'}
        </span>{' '}
        {close}
      </span>
    )
  }
  return (
    <span className={cn('min-w-0 truncate', row.kind === 'null' ? 'text-faint' : 'text-fg')}>
      {row.preview}
    </span>
  )
}

export function TreeView({ value }: { value: unknown }) {
  const rowHeight = useRowHeight()

  const [expansion, setExpansion] = useState<Expansion>(() => ({
    source: value,
    expanded: defaultExpanded(value),
    touched: false,
    capped: false,
  }))

  // Adjust state during render when the value changes, rather than in an
  // effect, so the tree never paints one frame with the previous expansion.
  let current = expansion
  if (expansion.source !== value) {
    current = {
      source: value,
      expanded: expansion.touched ? expansion.expanded : defaultExpanded(value),
      touched: expansion.touched,
      capped: false,
    }
    setExpansion(current)
  }

  const rows = useMemo(() => flattenTree(value, current.expanded), [value, current.expanded])
  const total = useMemo(() => countNodes(value), [value])

  const [selected, setSelected] = useState<string | null>(null)
  const selectedIndex = useMemo(
    () => (selected === null ? -1 : rows.findIndex((r) => r.pointer === selected)),
    [rows, selected],
  )

  // Copy targets for the selected row. Shown in the header rather than on the
  // row itself, so they are reachable on touch and never hover-only.
  const selectedPaths = useMemo(() => {
    if (selectedIndex < 0) return null
    const path = pathOf(rows, selectedIndex)
    return { pointer: toJsonPointer(path), dot: toDotPath(path), jq: toJqPath(path) }
  }, [rows, selectedIndex])

  const scrollRef = useRef<HTMLDivElement>(null)
  // The rule guards React Compiler memoisation, and this build does not run the
  // compiler. TanStack Virtual is the documented exception it flags.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 20,
  })

  // Rows are a fixed height, so a breakpoint change is the only re-measure.
  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  function setExpanded(next: ReadonlySet<string>, capped = false) {
    setExpansion({ source: value, expanded: next, touched: true, capped })
  }

  function toggleRow(row: FlatNode) {
    if (row.childCount > 0) setExpanded(toggle(current.expanded, row.pointer))
  }

  function select(index: number) {
    const row = rows[index]
    if (row === undefined) return
    setSelected(row.pointer)
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = selectedIndex
    const row = rows[i]
    switch (e.key) {
      case 'ArrowDown':
        select(i < 0 ? 0 : Math.min(i + 1, rows.length - 1))
        break
      case 'ArrowUp':
        select(i < 0 ? 0 : Math.max(i - 1, 0))
        break
      case 'Home':
        select(0)
        break
      case 'End':
        select(rows.length - 1)
        break
      case 'ArrowRight':
        if (row === undefined) select(0)
        else if (row.childCount > 0 && !row.expanded) toggleRow(row)
        else if (row.expanded) select(i + 1)
        break
      case 'ArrowLeft':
        if (row === undefined) select(0)
        else if (row.expanded) toggleRow(row)
        else if (row.parent >= 0) select(row.parent)
        break
      case 'Enter':
      case ' ':
        if (row !== undefined) toggleRow(row)
        break
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 border-b border-border px-3 py-1">
        <span className="font-mono text-[11px] text-faint">
          {formatCount(total)} {total === 1 ? 'node' : 'nodes'}
          {current.capped && ` · expanded the first ${formatCount(rows.length)} rows`}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          onClick={() => {
            const all = allContainerPointers(value)
            setExpanded(all.expanded, all.capped)
          }}
        >
          Expand all
        </Button>
        <Button variant="ghost" onClick={() => setExpanded(new Set())}>
          Collapse all
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-1">
        {selectedPaths === null ? (
          <span className="py-1 text-[12px] text-faint">Select a row to copy its path</span>
        ) : (
          <>
            <code
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted"
              title={selectedPaths.pointer === '' ? '(root)' : selectedPaths.pointer}
            >
              {selectedPaths.dot}
            </code>
            <CopyButton value={selectedPaths.pointer || '/'} label="Pointer" />
            <CopyButton value={selectedPaths.dot} label="Path" />
            <CopyButton value={selectedPaths.jq} label="jq" />
          </>
        )}
      </div>

      <div
        ref={scrollRef}
        role="tree"
        aria-label="JSON tree"
        tabIndex={0}
        aria-activedescendant={selectedIndex >= 0 ? `json-tree-row-${selectedIndex}` : undefined}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto bg-bg font-mono text-[13px] md:text-[12px] scroll-thin"
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!
            const isSelected = item.index === selectedIndex
            const isContainer = row.childCount > 0
            return (
              <div
                key={row.pointer}
                id={`json-tree-row-${item.index}`}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={isContainer ? row.expanded : undefined}
                aria-selected={isSelected}
                title={row.preview.length > 60 ? row.preview : undefined}
                onClick={() => {
                  setSelected(row.pointer)
                  toggleRow(row)
                }}
                className={cn(
                  'absolute left-0 top-0 flex w-full cursor-default items-center gap-1 whitespace-nowrap border-l-2 pr-3',
                  isSelected ? 'border-accent bg-surface-2' : 'border-transparent',
                )}
                style={{
                  height: rowHeight,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: 8 + row.depth * INDENT,
                }}
              >
                <span className="flex w-3.5 shrink-0 justify-center text-faint" aria-hidden>
                  {isContainer && (
                    <ChevronRight
                      size={12}
                      className={cn('transition-transform', row.expanded && 'rotate-90')}
                    />
                  )}
                </span>
                {row.key !== null && (
                  <span className="shrink-0 text-muted">
                    {typeof row.key === 'number' ? row.key : JSON.stringify(row.key)}
                    <span className="text-faint">:</span>
                  </span>
                )}
                <RowValue row={row} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
