import { useDeferredValue, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatBytes, formatCount } from '@/lib/util/bytes'
import { cn } from '@/lib/util/cn'
import {
  buildIndex,
  clean,
  inspectAt,
  summary,
  UNICODE_FLAGS,
  type CleanResult,
  type CodePointRow,
  type NormalizationForm,
  type UnicodeFlag,
} from '@fadeltd/devtools-core/unicode'

interface State {
  text: string
  flaggedOnly: boolean
  normalize: NormalizationForm
}

const INITIAL: State = { text: '', flaggedOnly: false, normalize: 'none' }

const FLAG_HINTS: Record<UnicodeFlag, string> = {
  invisible: 'Zero-width and filler characters that draw nothing',
  bidi: 'Bidirectional controls that reorder how text displays (Trojan Source)',
  control: 'Control characters other than tab, line feed and carriage return',
  space: 'Spaces other than U+0020, such as the no-break space',
  variation: 'Variation selectors, which pick emoji or text presentation',
  tag: 'Tag characters outside a flag emoji, which can carry hidden text',
  'private-use': 'Private-use code points with no standard meaning',
  'lone-surrogate': 'Half of a surrogate pair: invalid UTF-16, saved as U+FFFD',
  replacement: 'U+FFFD, left behind when an earlier decode failed',
}

// The flags that mean "someone or something hid this from you". The rest are
// worth seeing but are often legitimate.
const WARN = new Set<UnicodeFlag>(['invisible', 'bidi', 'tag'])

// Matches the JSON tree: a 44px touch target below md, the 22px code-table
// grid from DESIGN.md above it.
const NARROW = '(max-width: 47.99rem)'
const ROW_NARROW = 44
const ROW_WIDE = 22

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

// One grid for header and rows, so the columns line up. Flags and name come
// before category and bytes: they are what the user is looking for, and the
// table scrolls sideways in a narrow pane rather than squeezing the data.
const GRID =
  'grid grid-cols-[3.5rem_4.5rem_3rem_5rem_minmax(14rem,1fr)_2rem_6.5rem] items-center gap-x-2'

function describeClean(r: CleanResult): string {
  const parts: string[] = []
  const removed = r.removed.invisible + r.removed.bidi + r.removed.tag
  if (removed > 0) {
    const kinds = [
      r.removed.invisible > 0 && `${formatCount(r.removed.invisible)} invisible`,
      r.removed.bidi > 0 && `${formatCount(r.removed.bidi)} bidi`,
      r.removed.tag > 0 && `${formatCount(r.removed.tag)} tag`,
    ].filter(Boolean)
    parts.push(`removes ${kinds.join(', ')}`)
  }
  if (r.spacesReplaced > 0) {
    parts.push(`replaces ${formatCount(r.spacesReplaced)} space${r.spacesReplaced === 1 ? '' : 's'}`)
  }
  if (r.normalized) parts.push('normalises')
  return parts.length === 0 ? 'Nothing to clean' : `Clean ${parts.join(', ')}`
}

function CharCell({ row }: { row: CodePointRow }) {
  if (row.placeholder) {
    return (
      <span className="justify-self-center border border-border bg-surface-2 px-1 text-[10px] leading-[14px] text-muted">
        {row.display}
      </span>
    )
  }
  // Isolated so a right-to-left letter cannot reorder the row around it.
  return (
    <span className="justify-self-center text-[14px] text-fg [unicode-bidi:isolate]" dir="ltr">
      {row.display}
    </span>
  )
}

function FlagCell({ row }: { row: CodePointRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {row.flags.map((flag) => (
        <Badge key={flag} tone={WARN.has(flag) ? 'warn' : 'neutral'} title={FLAG_HINTS[flag]}>
          {flag}
        </Badge>
      ))}
      {row.name !== null && <span className="truncate text-muted">{row.name}</span>}
    </span>
  )
}

export default function UnicodeTool() {
  useToolUsageTracker('unicode')
  const { state, setState, reset, hydrating } = useToolState<State>('unicode', INITIAL)

  const text = useDeferredValue(state.text)
  const index = useMemo(() => buildIndex(text), [text])
  // Positions are not needed: the table reads them straight off the index.
  const stats = useMemo(() => summary(index, { maxPositions: 0 }), [index])

  const cleaned = useMemo<CleanResult | null>(() => {
    if (stats.flaggedCount === 0 && state.normalize === 'none') return null
    return clean(text, { normalize: state.normalize })
  }, [text, stats.flaggedCount, state.normalize])
  const canClean = cleaned !== null && cleaned.changed

  const flaggedOnly = state.flaggedOnly
  const rowCount = flaggedOnly ? index.flagged.length : index.codePoints

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

  // Switching views is a different list, so start it at the top. Edits keep
  // the offset; the browser clamps it if the list got shorter.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [flaggedOnly])

  const inputRef = useRef<HTMLDivElement>(null)

  /** Puts the caret on the character in the input, which is where the fix happens. */
  function selectInInput(row: CodePointRow) {
    const ta = inputRef.current?.querySelector('textarea')
    // The table may trail the textarea by a keystroke; offsets would be stale.
    if (!ta || ta.value !== index.text) return
    ta.focus()
    ta.setSelectionRange(row.offset, row.offset + row.length)
  }

  function applyClean() {
    if (cleaned === null || !cleaned.changed) return
    const next = cleaned.text
    setState((p) => ({ ...p, text: next }))
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy cleaned text',
      group: 'Unicode Inspector',
      scope: 'tool',
      whileTyping: true,
      run: () => {
        if (canClean) void copyText(cleaned.text)
      },
    },
  ])

  const presentFlags = UNICODE_FLAGS.filter((f) => stats.flagCounts[f] > 0)

  let body: ReactNode
  if (text === '') {
    body = (
      <p className="p-3 text-[12px] text-faint">
        {hydrating ? 'Restoring your last input…' : 'Paste text to see every code point in it.'}
      </p>
    )
  } else if (rowCount === 0) {
    body = (
      <p className="flex items-center gap-1.5 p-3 text-[12px] text-add">
        <Check size={14} aria-hidden />
        No invisible or unusual characters.
      </p>
    )
  } else {
    body = (
      <div
        ref={scrollRef}
        role="table"
        aria-label="Code points"
        aria-rowcount={rowCount + 1}
        className="min-h-0 flex-1 overflow-auto bg-bg font-mono text-[13px] md:text-[12px] scroll-thin"
      >
        <div className="min-w-[33rem]">
          <div
            role="row"
            className={cn(
              GRID,
              'sticky top-0 z-10 border-b border-border bg-surface px-3 text-[11px] text-faint',
            )}
            style={{ height: rowHeight }}
          >
            <span role="columnheader" className="text-right">#</span>
            <span role="columnheader">Ln:Col</span>
            <span role="columnheader" className="text-center">Char</span>
            <span role="columnheader">Code</span>
            <span role="columnheader">Flags / name</span>
            <span role="columnheader">Cat</span>
            <span role="columnheader">UTF-8</span>
          </div>
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const cpIndex = flaggedOnly ? index.flagged[item.index]! : item.index
              const row = inspectAt(index, cpIndex)
              if (row === null) return null
              const warn = row.flags.some((f) => WARN.has(f))
              return (
                <button
                  key={cpIndex}
                  type="button"
                  role="row"
                  aria-rowindex={item.index + 2}
                  onClick={() => selectInInput(row)}
                  title="Select in input"
                  className={cn(
                    GRID,
                    'absolute left-0 top-0 w-full cursor-default whitespace-nowrap border-l-2 pr-3 pl-2.5 text-left',
                    warn
                      ? 'border-warn bg-warn-bg'
                      : row.flags.length > 0
                        ? 'border-border-strong bg-surface'
                        : 'border-transparent',
                  )}
                  style={{ height: rowHeight, transform: `translateY(${item.start}px)` }}
                >
                  <span role="cell" className="text-right tabular-nums text-faint">
                    {formatCount(row.index)}
                  </span>
                  <span role="cell" className="tabular-nums text-muted">
                    {row.line}:{row.column}
                  </span>
                  <span role="cell" className="flex justify-center">
                    <CharCell row={row} />
                  </span>
                  <span role="cell" className="text-fg">
                    {row.hex}
                  </span>
                  <span role="cell" className="min-w-0">
                    <FlagCell row={row} />
                  </span>
                  <span role="cell" className="text-muted" title={row.categoryName}>
                    {row.category}
                  </span>
                  <span role="cell" className="truncate text-muted" title={`UTF-16: ${row.utf16}`}>
                    {row.utf8 ?? 'invalid'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <ToolFrame
      slug="unicode"
      actions={
        <>
          <Toggle
            checked={flaggedOnly}
            onChange={(v) => setState((p) => ({ ...p, flaggedOnly: v }))}
          >
            Flagged only
          </Toggle>
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        rightLabel="Code points"
        left={
          <div ref={inputRef} className="flex min-h-0 w-full">
            <CodeArea
              value={state.text}
              onChange={(e) => setState((p) => ({ ...p, text: e.target.value }))}
              placeholder="Paste the text that is misbehaving…"
            />
          </div>
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted">
              <span title="Code points: what most character limits count">
                {formatCount(stats.codePoints)} code points
              </span>
              <span title="Grapheme clusters: what a person would count">
                {formatCount(stats.graphemes)} graphemes
              </span>
              <span title="UTF-16 units: JavaScript's String.length">
                {formatCount(stats.utf16Units)} UTF-16
              </span>
              <span title="UTF-8 bytes, as saved to a file or sent over the wire">
                {formatBytes(stats.utf8Bytes)}
              </span>
              <span>
                {formatCount(stats.lines)} line{stats.lines === 1 ? '' : 's'}
              </span>
              {presentFlags.length > 0 && (
                <span className="flex flex-wrap items-center gap-1">
                  {presentFlags.map((flag) => (
                    <Badge key={flag} tone={WARN.has(flag) ? 'warn' : 'neutral'} title={FLAG_HINTS[flag]}>
                      {flag} {formatCount(stats.flagCounts[flag])}
                    </Badge>
                  ))}
                </span>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1">
              <Button
                variant="primary"
                disabled={!canClean}
                onClick={applyClean}
                title="Remove invisible, bidi and tag characters and replace exotic spaces, in the input"
              >
                Clean
              </Button>
              <CopyButton value={canClean ? cleaned.text : ''} label="Copy cleaned" />
              <Select
                value={state.normalize}
                onChange={(e) =>
                  setState((p) => ({ ...p, normalize: e.target.value as NormalizationForm }))
                }
                title="Unicode normalisation applied by Clean"
              >
                <option value="none">No normalisation</option>
                <option value="NFC">NFC</option>
                <option value="NFKC">NFKC</option>
              </Select>
              <span className="px-1 text-[12px] text-faint">
                {cleaned === null ? 'Nothing to clean' : describeClean(cleaned)}
              </span>
            </div>

            {body}
          </div>
        }
      />
    </ToolFrame>
  )
}
