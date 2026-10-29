import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowLeftRight, ChevronDown, ChevronRight } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import {
  buildQuery,
  convert,
  parseInput,
  type Mode,
  type ParsedInput,
  type QueryRow,
  type Variant,
} from '@fadeltd/devtools-core/url'

interface State {
  input: string
  mode: Mode
  variant: Variant
  lenient: boolean
  showParams: boolean
}

const INITIAL: State = {
  input: '',
  mode: 'encode',
  variant: 'component',
  lenient: false,
  showParams: true,
}

const VARIANT_LABELS: Record<Variant, { label: string; title: string }> = {
  component: { label: 'Component', title: 'encodeURIComponent: one value, every reserved character escaped' },
  uri: { label: 'Full URL', title: 'encodeURI: keeps : / ? # & = so the URL still works' },
  form: { label: 'Form (+ for space)', title: 'application/x-www-form-urlencoded, as URLSearchParams writes it' },
}

// One grid for the header and every row, so the columns line up without a
// <table>: virtual rows are absolutely positioned, which a table row cannot be.
const PARAM_GRID = 'grid grid-cols-[30%_minmax(0,1fr)_auto]'

/**
 * A one-line row on desktop: 28px Copy button plus padding and the hairline.
 * Rows that wrap, show a raw form or a badge are taller, and phones use 44px
 * buttons; the virtualiser measures every row it renders, so this only shapes
 * the scrollbar before then.
 */
const PARAM_ROW_ESTIMATE = 37

export default function UrlTool() {
  useToolUsageTracker('url')
  const { state, setState, reset } = useToolState<State>('url', INITIAL)

  const deferred = useDeferredValue(state)
  const result = useMemo(
    () => convert(deferred.input, { mode: deferred.mode, variant: deferred.variant, lenient: deferred.lenient }),
    [deferred.input, deferred.mode, deferred.variant, deferred.lenient],
  )
  const parsed = useMemo(() => parseInput(deferred.input), [deferred.input])

  function swap() {
    setState((p) => ({
      ...p,
      mode: p.mode === 'encode' ? 'decode' : 'encode',
      // Feed the output back in: what you want after a swap, and how you peel
      // a second layer off double-encoded input.
      input: result.error === null && result.output !== '' ? result.output : p.input,
    }))
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'URL',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(result.output),
    },
    {
      combo: 'mod+shift+s',
      label: 'Swap encode/decode',
      group: 'URL',
      scope: 'tool',
      whileTyping: true,
      run: swap,
    },
  ])

  const input = deferred.input
  const { output, error } = result

  return (
    <ToolFrame
      slug="url"
      actions={
        <>
          <Segmented
            value={state.mode}
            onChange={(mode) => setState((p) => ({ ...p, mode }))}
            options={[
              { value: 'encode', label: 'Encode' },
              { value: 'decode', label: 'Decode' },
            ]}
          />
          <Select
            value={state.variant}
            onChange={(e) => setState((p) => ({ ...p, variant: e.target.value as Variant }))}
            title={VARIANT_LABELS[state.variant].title}
          >
            {(Object.keys(VARIANT_LABELS) as Variant[]).map((v) => (
              <option key={v} value={v} title={VARIANT_LABELS[v].title}>
                {VARIANT_LABELS[v].label}
              </option>
            ))}
          </Select>
          {state.mode === 'decode' && (
            <Toggle checked={state.lenient} onChange={(v) => setState((p) => ({ ...p, lenient: v }))}>
              Skip malformed
            </Toggle>
          )}
          <Button onClick={swap} title="Swap direction (⌘⇧S)">
            <ArrowLeftRight size={14} aria-hidden />
            Swap
          </Button>
          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <TwoPane
            left={
              <CodeArea
                value={state.input}
                onChange={(e) => setState((p) => ({ ...p, input: e.target.value }))}
                placeholder={
                  state.mode === 'encode'
                    ? 'Paste text or a URL to percent-encode…'
                    : 'Paste a percent-encoded value, query string or URL…'
                }
              />
            }
            right={
              <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
                <CodeArea value={output} readOnly placeholder="Output appears here" />
                {(input !== '' || error !== null) && (
                  <div className="flex shrink-0 flex-col gap-1 border-t border-border px-3 py-1.5 text-[12px] leading-snug">
                    {error !== null && <p className="text-del">{error.message}</p>}
                    {result.warnings.map((w) => (
                      <p key={w.kind} className="text-warn">
                        {w.message}
                      </p>
                    ))}
                    {error === null && (
                      <p className="font-mono text-[11px] text-faint">
                        {formatCount(input.length)} → {formatCount(output.length)} characters
                      </p>
                    )}
                  </div>
                )}
              </div>
            }
          />
        </div>
        {parsed.kind !== 'none' && (
          <ParamsPanel
            parsed={parsed}
            open={state.showParams}
            onToggle={() => setState((p) => ({ ...p, showParams: !p.showParams }))}
          />
        )}
      </div>
    </ToolFrame>
  )
}

function ParamsPanel({
  parsed,
  open,
  onToggle,
}: {
  parsed: Exclude<ParsedInput, { kind: 'none' }>
  open: boolean
  onToggle: () => void
}) {
  const { rows } = parsed
  const normalized = useMemo(() => buildQuery(rows), [rows])
  const Chevron = open ? ChevronDown : ChevronRight
  const scrollRef = useRef<HTMLDivElement>(null)

  const lead = (
    <>
      {parsed.kind === 'url' && <UrlParts parts={parsed.parts} />}
      {parsed.kind === 'query' && parsed.hash !== '' && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-[12px]">
          <dt className="text-muted">Fragment</dt>
          <dd className="break-all font-mono">{parsed.hash}</dd>
        </dl>
      )}
    </>
  )

  return (
    <section className="flex max-h-[45dvh] shrink-0 flex-col border-t border-border bg-surface">
      <div className="flex shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-medium text-muted hover:text-fg md:min-h-7"
        >
          <Chevron size={14} aria-hidden className="shrink-0" />
          <span className="truncate">
            {parsed.kind === 'url' ? 'URL parts and query' : 'Query'} · {formatCount(rows.length)}{' '}
            {rows.length === 1 ? 'parameter' : 'parameters'}
          </span>
        </button>
        {open && rows.length > 0 && <CopyButton value={normalized} label="Copy normalized" />}
      </div>

      {open && (
        // `relative` makes this the offsetParent, so the list can read its own offset below the URL parts.
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto border-t border-border bg-bg scroll-thin">
          {rows.length === 0 ? (
            <>
              {lead}
              <p className="px-3 py-2 text-[12px] text-faint">No query parameters.</p>
            </>
          ) : (
            <ParamList lead={lead} rows={rows} scrollRef={scrollRef} />
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Every parameter, virtualised: a pasted tracking URL or a generated query can
 * carry thousands, and each row holds a Copy button. The URL parts above share
 * the scroll, so the list tells the virtualiser how far down it starts.
 */
function ParamList({
  lead,
  rows,
  scrollRef,
}: {
  lead: ReactNode
  rows: QueryRow[]
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const leadRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  // The parts above grow and shrink with the URL and with the pane width, as
  // long values wrap. Watching them is what keeps the offset true; reading it
  // once would put rows under the header after the first edit.
  useLayoutEffect(() => {
    const leadEl = leadRef.current
    const headerEl = headerRef.current
    if (!leadEl || !headerEl) return
    const observer = new ResizeObserver(() => setScrollMargin(listRef.current?.offsetTop ?? 0))
    observer.observe(leadEl)
    observer.observe(headerEl)
    return () => observer.disconnect()
  }, [])

  // The rule guards React Compiler memoisation, and this build does not run the
  // compiler. TanStack Virtual is the documented exception it flags.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PARAM_ROW_ESTIMATE,
    // Keys repeat legally; the offset in the query never does. Keying the
    // measurement cache by it keeps a measured height with its row.
    getItemKey: (i) => rows[i]!.offset,
    scrollMargin,
    overscan: 10,
  })

  return (
    <>
      <div ref={leadRef}>{lead}</div>
      <div
        role="table"
        aria-label="Query parameters"
        aria-rowcount={rows.length + 1}
        className="font-mono text-[12px] leading-4.5"
      >
        <div
          ref={headerRef}
          role="row"
          className={`${PARAM_GRID} sticky top-0 z-10 border-b border-border bg-surface text-left font-sans text-[11px] text-faint`}
        >
          <span role="columnheader" className="px-3 py-1 font-medium">
            Key
          </span>
          <span role="columnheader" className="px-3 py-1 font-medium">
            Value
          </span>
          <span role="columnheader" className="px-3 py-1">
            <span className="sr-only">Copy</span>
          </span>
        </div>
        <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <ParamRow
              key={item.key}
              row={rows[item.index]!}
              index={item.index}
              measureRef={virtualizer.measureElement}
              top={item.start - scrollMargin}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function UrlParts({ parts }: { parts: Extract<ParsedInput, { kind: 'url' }>['parts'] }) {
  const credentials =
    parts.hasUsername && parts.hasPassword
      ? 'username and password'
      : parts.hasPassword
        ? 'password'
        : parts.hasUsername
          ? 'username'
          : null
  const items: [string, string][] = [
    ['Protocol', parts.protocol],
    ['Host', parts.hostname || '—'],
    ['Port', parts.port || 'default'],
    ['Path', parts.pathname || '—'],
    ['Fragment', parts.hash || '—'],
  ]
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-[12px]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 break-all font-mono">{value}</dd>
        </div>
      ))}
      {credentials !== null && (
        <div className="contents">
          <dt className="text-muted">Credentials</dt>
          <dd className="text-warn">Contains a {credentials} (not shown)</dd>
        </div>
      )}
    </dl>
  )
}

function ParamRow({
  row,
  index,
  measureRef,
  top,
}: {
  row: QueryRow
  index: number
  measureRef: (node: Element | null) => void
  top: number
}) {
  return (
    <div
      ref={measureRef}
      data-index={index}
      role="row"
      aria-rowindex={index + 2}
      className={`${PARAM_GRID} absolute left-0 top-0 w-full items-start border-b border-border`}
      style={{ transform: `translateY(${top}px)` }}
    >
      <span role="cell" className="break-all px-3 py-1.5 text-muted">
        {row.key === '' ? <span className="font-sans text-faint">(empty key)</span> : row.key}
        {row.rawKey !== row.key && <span className="block text-[11px] text-faint">{row.rawKey}</span>}
      </span>
      <span role="cell" className="break-all px-3 py-1.5">
        {row.value === null ? (
          <span className="font-sans text-faint">flag, no “=”</span>
        ) : row.value === '' ? (
          <span className="font-sans text-faint">empty</span>
        ) : (
          row.value
        )}
        {row.rawValue !== null && row.rawValue !== row.value && (
          <span className="block text-[11px] text-faint">{row.rawValue}</span>
        )}
        {row.malformed && (
          <Badge tone="warn" className="mt-1">
            malformed %, kept as-is
          </Badge>
        )}
      </span>
      <span role="cell" className="px-3 py-1">
        <CopyButton value={row.value ?? ''} />
      </span>
    </div>
  )
}
