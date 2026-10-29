import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Copy, Download } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select } from '@/components/ui/Select'
import { copyText } from '@/lib/util/clipboard'
import { formatBytes } from '@/lib/util/bytes'
import { downloadBlob } from '@/lib/util/download'
import { hexDumpRows, hexRow, hexRowCount, HEX_ROW_BYTES } from '@fadeltd/devtools-core/base64'
import { digest, toHex } from '@fadeltd/devtools-core/hash'
import { useAsyncValue } from './useAsyncValue'

// Rows are text, not targets, so they follow the 13px/18px data rhythm on
// desktop and get a little more air on a phone, where the font is larger.
const NARROW = '(max-width: 47.99rem)'
const ROW_NARROW = 20
const ROW_WIDE = 18

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

/**
 * Browsers cap an element's height (Firefox near 17.9M px), so one scroller
 * cannot hold 25 MB of rows. 8 MB is 524,288 rows: about 10.5M px at 20px.
 */
const PAGE_BYTES = 8 * 1024 * 1024
const PAGE_ROWS = PAGE_BYTES / HEX_ROW_BYTES
/** A 1 MB dump is ~5 MB of text: past that the clipboard gets the head only. */
const COPY_MAX_BYTES = 1024 * 1024
/** Rows formatted per step of the download, between yields to the event loop. */
const CHUNK_ROWS = 32 * 1024

const HEADER = `${'offset'.padEnd(8)}  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  ascii`

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(await digest('SHA-256', bytes))
}

/**
 * The whole dump as a Blob, built a chunk at a time. Each chunk's string is
 * folded into the Blob and dropped, so a 25 MB input never exists as one
 * 120 MB string, and the page keeps painting between chunks.
 */
async function dumpBlob(bytes: Uint8Array): Promise<Blob> {
  const total = hexRowCount(bytes.length)
  let blob = new Blob([], { type: 'text/plain' })
  for (let row = 0; row < total; row += CHUNK_ROWS) {
    const text = hexDumpRows(bytes, row, row + CHUNK_ROWS)
    blob = new Blob([blob, text, '\n'], { type: 'text/plain' })
    // Sequential on purpose: the await is a yield to the event loop, not parallel work.
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return blob
}

function pageLabel(page: number, length: number): string {
  const from = page * PAGE_BYTES
  const to = Math.min(from + PAGE_BYTES, length)
  return `${formatBytes(from, 0)} – ${formatBytes(to, 0)}`
}

/**
 * A virtualised hex dump with the facts about the bytes on top: what they
 * are, how big, and their SHA-256. Only the rows in view are formatted or in
 * the DOM, so a 25 MB file scrolls like a 2 KB one.
 */
export function HexView({
  bytes,
  type,
  name,
  actions,
}: {
  bytes: Uint8Array
  /** The sniffed type, or null when the bytes match no signature. */
  type: string | null
  /** Base for download file names. */
  name: string
  /** Extra buttons for the header, such as a raw-bytes download. */
  actions?: ReactNode
}) {
  const sha = useAsyncValue(bytes, sha256Hex)
  const [pageState, setPage] = useState(0)
  const [copied, setCopied] = useState(false)
  const [preparing, setPreparing] = useState(false)

  const pages = Math.max(1, Math.ceil(bytes.length / PAGE_BYTES))
  const page = Math.min(pageState, pages - 1)
  const totalRows = hexRowCount(bytes.length)
  const firstRow = page * PAGE_ROWS
  const rowCount = Math.max(0, Math.min(PAGE_ROWS, totalRows - firstRow))

  const rowHeight = useRowHeight()
  const scrollRef = useRef<HTMLDivElement>(null)
  // The rule guards React Compiler memoisation, and this build does not run the
  // compiler. TanStack Virtual is the documented exception it flags.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 20,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  // A different page, or different bytes, is a different list: start at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [page, bytes])

  const copyCapped = bytes.length > COPY_MAX_BYTES

  function copyDump() {
    // Built synchronously so the clipboard write stays inside the click: Safari
    // refuses one that happens after an await.
    const text = hexDumpRows(bytes, 0, hexRowCount(Math.min(bytes.length, COPY_MAX_BYTES)))
    void copyText(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  async function downloadDump() {
    if (preparing) return
    setPreparing(true)
    try {
      downloadBlob(await dumpBlob(bytes), `${name}.hex.txt`)
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-1.5 font-mono text-[11px] text-faint">
        <span className="text-muted">{type ?? 'unknown binary'}</span>
        <span>{formatBytes(bytes.length)}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 whitespace-nowrap">SHA-256</span>
          {sha.status === 'done' ? (
            <span className="min-w-0 truncate text-fg select-all" title={sha.value}>
              {sha.value}
            </span>
          ) : sha.status === 'error' ? (
            <Badge tone="del" title={sha.error}>
              unavailable
            </Badge>
          ) : (
            <span>computing…</span>
          )}
        </span>
        <CopyButton value={sha.status === 'done' ? sha.value : ''} label="Copy SHA-256" />
        <span className="flex-1" />
        {pages > 1 && (
          <Select
            value={String(page)}
            onChange={(e) => setPage(Number(e.target.value))}
            title="Each page shows 8 MB of the dump"
          >
            {Array.from({ length: pages }, (_, i) => (
              <option key={i} value={i}>
                {pageLabel(i, bytes.length)}
              </option>
            ))}
          </Select>
        )}
        <Button
          onClick={copyDump}
          disabled={bytes.length === 0}
          title={copyCapped ? 'Copies the dump of the first 1 MB; Download has all of it' : 'Copy the hex dump'}
        >
          {copied ? <Check size={14} className="text-add" aria-hidden /> : <Copy size={14} aria-hidden />}
          <span>{copied ? 'Copied' : copyCapped ? 'Copy first 1 MB' : 'Copy dump'}</span>
        </Button>
        <Button onClick={() => void downloadDump()} disabled={preparing || bytes.length === 0} title="Download the whole hex dump as text">
          <Download size={14} aria-hidden />
          {preparing ? 'Preparing…' : 'Dump'}
        </Button>
        {actions}
      </div>

      <div
        ref={scrollRef}
        role="region"
        aria-label="Hex dump"
        className="min-h-0 flex-1 overflow-auto bg-bg font-mono text-[13px] md:text-[12px] scroll-thin"
      >
        <div className="relative min-w-full" style={{ width: 'calc(78ch + 1.5rem)' }}>
          <div
            aria-hidden
            className="sticky top-0 z-10 flex items-center border-b border-border bg-surface px-3 whitespace-pre text-faint"
            style={{ height: rowHeight }}
          >
            {HEADER}
          </div>
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = hexRow(bytes, firstRow + item.index)
              return (
                <div
                  key={item.index}
                  className="absolute top-0 left-0 flex w-full items-center px-3 whitespace-pre"
                  style={{ height: rowHeight, transform: `translateY(${item.start}px)` }}
                >
                  <span className="text-faint">{row.offset}</span>
                  <span className="text-fg">{`  ${row.hex[0]}  ${row.hex[1]}  `}</span>
                  <span className="text-muted">{`|${row.ascii}|`}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
