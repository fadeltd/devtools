import { useDeferredValue, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'
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
import { formatCount } from '@/lib/util/bytes'
import { countStats } from '@/lib/text/counts'
import { parseLines, serializeLines } from './core/lines'
import { findNormalizationCollisions, runPipeline } from './core/pipeline'
import type { BlankPolicy, Op, SortMode } from './core/types'

/** The operations that have UI today. The Op union covers far more. */
const OPS = ['sort', 'dedupe', 'shuffle', 'reverse'] as const
type OpName = (typeof OPS)[number]

const OP_LABELS: Record<OpName, string> = {
  sort: 'Sort',
  dedupe: 'Remove duplicates',
  shuffle: 'Randomize',
  reverse: 'Reverse',
}

interface State {
  text: string
  op: OpName
  sortMode: SortMode
  sortDesc: boolean
  caseSensitive: boolean
  blanks: BlankPolicy
  dedupeKeep: 'first' | 'last'
  dedupeOutput: 'unique' | 'duplicates-only' | 'unique-only' | 'with-counts'
  shuffleNonce: number
}

const INITIAL: State = {
  text: '',
  op: 'sort',
  sortMode: 'natural',
  sortDesc: false,
  caseSensitive: false,
  blanks: 'keep',
  dedupeKeep: 'first',
  dedupeOutput: 'unique',
  shuffleNonce: 0,
}

function isOpName(v: string): v is OpName {
  return (OPS as readonly string[]).includes(v)
}

function buildOp(s: State): Op {
  switch (s.op) {
    case 'sort':
      return {
        kind: 'sort',
        order: s.sortDesc ? 'desc' : 'asc',
        mode: s.sortMode,
        caseSensitive: s.caseSensitive,
        blanks: s.blanks,
      }
    case 'dedupe':
      return {
        kind: 'dedupe',
        caseSensitive: s.caseSensitive,
        trimKey: false,
        keep: s.dedupeKeep,
        output: s.dedupeOutput,
      }
    case 'shuffle':
      return { kind: 'shuffle', source: 'crypto' }
    case 'reverse':
      return { kind: 'reverse' }
  }
}

export default function ListTool() {
  useToolUsageTracker('list')
  const navigate = useNavigate()
  const location = useLocation()

  const { state, setState, reset } = useToolState<State>('list', INITIAL)

  // /list/sort, /list/dedupe, ... deep-link straight to an operation, so
  // muscle memory and bookmarks work as if these were separate pages.
  const routeOp = location.pathname.split('/')[2] ?? ''
  const op: OpName = isOpName(routeOp) ? routeOp : state.op

  function setOp(next: OpName) {
    setState((p) => ({ ...p, op: next }))
    void navigate(`/list/${next}`, { replace: true })
  }

  // Keeps typing responsive: the transform runs against a deferred snapshot.
  const deferredText = useDeferredValue(state.text)
  const effective = useMemo(() => ({ ...state, op, text: deferredText }), [state, op, deferredText])

  const result = useMemo(() => {
    const doc = parseLines(effective.text)
    // shuffleNonce is read here so that "Shuffle again" re-runs the pipeline.
    void effective.shuffleNonce
    return runPipeline(doc, [buildOp(effective)])
  }, [effective])

  const output = useMemo(() => serializeLines(result.doc), [result.doc])
  const counts = useMemo(() => countStats(output), [output])
  const inputLines = result.steps[0]?.inLines ?? 0
  const outputLines = result.steps[0]?.outLines ?? 0

  const collisions = useMemo(
    () => (op === 'dedupe' ? findNormalizationCollisions(result.doc.lines) : 0),
    [op, result.doc.lines],
  )

  const inputDoc = useMemo(() => parseLines(state.text), [state.text])

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'List tools',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
    {
      combo: 'mod+shift+backspace',
      label: 'Clear input',
      group: 'List tools',
      scope: 'tool',
      whileTyping: true,
      run: () => reset(),
    },
  ])

  return (
    <ToolFrame
      slug="list"
      actions={
        <>
          <Select value={op} onChange={(e) => setOp(e.target.value as OpName)}>
            {OPS.map((o) => (
              <option key={o} value={o}>
                {OP_LABELS[o]}
              </option>
            ))}
          </Select>

          {op === 'sort' && (
            <>
              <Select
                value={state.sortMode}
                onChange={(e) => setState((p) => ({ ...p, sortMode: e.target.value as SortMode }))}
                title="Sort mode"
              >
                <option value="natural">Natural (numbers in order)</option>
                <option value="locale">Alphabetical</option>
                <option value="codepoint">Codepoint (byte order)</option>
                <option value="length">Line length</option>
              </Select>
              <Toggle
                checked={state.sortDesc}
                onChange={(v) => setState((p) => ({ ...p, sortDesc: v }))}
              >
                Descending
              </Toggle>
              <Select
                value={state.blanks}
                onChange={(e) =>
                  setState((p) => ({ ...p, blanks: e.target.value as BlankPolicy }))
                }
                title="Blank lines"
              >
                <option value="keep">Blanks: in order</option>
                <option value="first">Blanks: first</option>
                <option value="last">Blanks: last</option>
                <option value="drop">Blanks: remove</option>
              </Select>
            </>
          )}

          {op === 'dedupe' && (
            <>
              <Select
                value={state.dedupeOutput}
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    dedupeOutput: e.target.value as State['dedupeOutput'],
                  }))
                }
              >
                <option value="unique">Keep unique lines</option>
                <option value="duplicates-only">Show only duplicates</option>
                <option value="unique-only">Show only non-repeated</option>
                <option value="with-counts">Prefix with counts</option>
              </Select>
              {state.dedupeOutput === 'unique' && (
                <Select
                  value={state.dedupeKeep}
                  onChange={(e) =>
                    setState((p) => ({ ...p, dedupeKeep: e.target.value as 'first' | 'last' }))
                  }
                >
                  <option value="first">Keep first</option>
                  <option value="last">Keep last</option>
                </Select>
              )}
            </>
          )}

          {(op === 'sort' || op === 'dedupe') && (
            <Toggle
              checked={state.caseSensitive}
              onChange={(v) => setState((p) => ({ ...p, caseSensitive: v }))}
            >
              Case sensitive
            </Toggle>
          )}

          {op === 'shuffle' && (
            <Button onClick={() => setState((p) => ({ ...p, shuffleNonce: p.shuffleNonce + 1 }))}>
              Shuffle again
            </Button>
          )}

          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset} title="Clear input">
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        left={
          <div className="flex min-h-0 w-full flex-col">
            <CodeArea
              value={state.text}
              onChange={(e) => setState((p) => ({ ...p, text: e.target.value }))}
              placeholder={'Paste your list here, one item per line…'}
            />
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
              <span>{formatCount(inputDoc.lines.length)} lines in</span>
              {inputDoc.eol === 'mixed' && (
                <Badge tone="warn" title="Output will use LF">
                  mixed line endings
                </Badge>
              )}
              {inputDoc.bom && <Badge tone="warn">BOM</Badge>}
            </div>
          </div>
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            <CodeArea value={output} readOnly placeholder="Output appears here" />
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
              <span>
                {formatCount(inputLines)} → {formatCount(outputLines)} lines
              </span>
              {inputLines > outputLines && (
                <Badge tone="add">−{formatCount(inputLines - outputLines)}</Badge>
              )}
              <span>{formatCount(counts.words)} words</span>
              <span>{formatCount(counts.graphemes)} chars</span>
              <span>{formatCount(counts.bytes)} bytes</span>
              {collisions > 0 && (
                <Badge tone="warn" title="These look identical but are encoded differently">
                  {collisions} differ only by Unicode form
                </Badge>
              )}
              {result.steps[0]?.error !== undefined && (
                <Badge tone="del">{result.steps[0].error}</Badge>
              )}
            </div>
          </div>
        }
      />
    </ToolFrame>
  )
}
