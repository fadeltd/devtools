import { useDeferredValue, useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Wand2 } from 'lucide-react'
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
import { analyze, stripJsonc, type JsonIssue } from './core/errors'
import {
  escapeAsJsonString,
  findNumberIssues,
  formatValue,
  minifyValue,
  ndjsonToArray,
  unescapeJsonString,
  type Indent,
} from './core/format'

type Mode = 'format' | 'minify' | 'escape' | 'unescape'

interface State {
  text: string
  mode: Mode
  indent: Indent
  sortKeys: boolean
  lenient: boolean
}

const INITIAL: State = {
  text: '',
  mode: 'format',
  indent: 2,
  sortKeys: false,
  lenient: false,
}

function IssueCard({ issue }: { issue: JsonIssue }) {
  const gutterWidth = String(
    issue.snippet.lines[issue.snippet.lines.length - 1]?.number ?? 1,
  ).length

  return (
    <div className="panel p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-px shrink-0 text-del" aria-hidden />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-fg">{issue.message}</div>
          <div className="font-mono text-[11px] text-faint">
            line {issue.line}, column {issue.column} · offset {issue.offset}
          </div>
        </div>
      </div>

      <pre className="mt-2 overflow-x-auto font-mono text-[12px] leading-[1.5] text-muted scroll-thin">
        {issue.snippet.lines.map((l) => (
          <span key={l.number}>
            <span className={l.number === issue.snippet.caretLine ? 'text-fg' : undefined}>
              {String(l.number).padStart(gutterWidth, ' ')} │ {l.text}
            </span>
            {'\n'}
            {l.number === issue.snippet.caretLine && (
              <span className="text-del">
                {' '.repeat(gutterWidth)} │ {' '.repeat(Math.max(0, issue.snippet.caretColumn - 1))}▲
                {'\n'}
              </span>
            )}
          </span>
        ))}
      </pre>

      {issue.hint !== null && <p className="mt-1 text-[12px] text-muted">{issue.hint}</p>}
    </div>
  )
}

export default function JsonTool() {
  useToolUsageTracker('json')
  const { state, setState, reset } = useToolState<State>('json', INITIAL)

  const deferred = useDeferredValue(state)
  const analysis = useMemo(
    () => analyze(deferred.text, { lenient: deferred.lenient, tabWidth: 2 }),
    [deferred.text, deferred.lenient],
  )

  const numberIssues = useMemo(() => findNumberIssues(deferred.text), [deferred.text])
  const precisionLoss = numberIssues.filter((n) => n.kind === 'precision')
  const reformatted = numberIssues.filter((n) => n.kind === 'reformatted')

  const output = useMemo(() => {
    const { text, mode, indent, sortKeys } = deferred
    if (text === '') return ''

    if (mode === 'escape') return escapeAsJsonString(text, { ascii: false })
    if (mode === 'unescape') {
      const r = unescapeJsonString(text)
      return r.ok ? r.value : ''
    }
    if (analysis.value === undefined) return ''
    return mode === 'minify'
      ? minifyValue(analysis.value, { sortKeys })
      : formatValue(analysis.value, { indent, sortKeys })
  }, [analysis.value, deferred])

  const unescapeError =
    deferred.mode === 'unescape' && deferred.text !== ''
      ? (() => {
          const r = unescapeJsonString(deferred.text)
          return r.ok ? null : r.message
        })()
      : null

  const isTextMode = state.mode === 'escape' || state.mode === 'unescape'
  const valid = analysis.flavor === 'json' || analysis.flavor === 'jsonc'

  function applyToInput(next: string) {
    setState((p) => ({ ...p, text: next }))
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'JSON',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
    {
      combo: 'mod+shift+f',
      label: 'Format',
      group: 'JSON',
      scope: 'tool',
      whileTyping: true,
      run: () => setState((p) => ({ ...p, mode: 'format' })),
    },
  ])

  return (
    <ToolFrame
      slug="json"
      actions={
        <>
          <Select
            value={state.mode}
            onChange={(e) => setState((p) => ({ ...p, mode: e.target.value as Mode }))}
          >
            <option value="format">Format</option>
            <option value="minify">Minify</option>
            <option value="escape">Escape as JSON string</option>
            <option value="unescape">Unescape JSON string</option>
          </Select>

          {state.mode === 'format' && (
            <Select
              value={String(state.indent)}
              onChange={(e) =>
                setState((p) => ({
                  ...p,
                  indent: e.target.value === 'tab' ? 'tab' : (Number(e.target.value) as 2 | 4),
                }))
              }
              title="Indent"
            >
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
              <option value="tab">Tabs</option>
            </Select>
          )}

          {!isTextMode && (
            <>
              <Toggle
                checked={state.sortKeys}
                onChange={(v) => setState((p) => ({ ...p, sortKeys: v }))}
              >
                Sort keys
              </Toggle>
              <Toggle
                checked={state.lenient}
                onChange={(v) => setState((p) => ({ ...p, lenient: v }))}
              >
                Allow comments / trailing commas
              </Toggle>
            </>
          )}

          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        rightLabel={isTextMode || valid ? 'Output' : 'Problems'}
        left={
          <div className="flex min-h-0 w-full flex-col">
            <CodeArea
              value={state.text}
              onChange={(e) => setState((p) => ({ ...p, text: e.target.value }))}
              placeholder={
                isTextMode ? 'Paste text or an escaped string…' : 'Paste JSON here…'
              }
            />
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
              <span>{formatBytes(new Blob([state.text]).size)}</span>
              {!isTextMode && analysis.flavor === 'json' && (
                <span className="flex items-center gap-1 text-add">
                  <CheckCircle2 size={12} aria-hidden /> valid JSON
                </span>
              )}
              {!isTextMode && analysis.flavor === 'jsonc' && (
                <Badge tone="warn">valid with comments / trailing commas</Badge>
              )}
              {!isTextMode && analysis.issues.length > 0 && (
                <Badge tone="del">
                  {formatCount(analysis.issues.length)}{' '}
                  {analysis.issues.length === 1 ? 'problem' : 'problems'}
                </Badge>
              )}
            </div>
          </div>
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            {/* NDJSON is the single most common thing pasted from a log file,
                and every free tool just says "error". */}
            {analysis.ndjson !== null && !valid && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-warn-bg/40 px-3 py-2">
                <span className="text-[13px]">
                  This looks like NDJSON — {formatCount(analysis.ndjson.records)} records, one per
                  line.
                </span>
                <Button onClick={() => applyToInput(ndjsonToArray(state.text))}>
                  <Wand2 size={14} aria-hidden />
                  Wrap as array
                </Button>
              </div>
            )}

            {!valid && !isTextMode && analysis.issues.length > 0 && !state.lenient && (
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
                <span className="text-[12px] text-muted">
                  Comments or trailing commas?
                </span>
                <Button onClick={() => applyToInput(stripJsonc(state.text))}>
                  <Wand2 size={14} aria-hidden />
                  Strip them
                </Button>
                <Button onClick={() => setState((p) => ({ ...p, lenient: true }))}>
                  Allow them
                </Button>
              </div>
            )}

            {precisionLoss.length > 0 && (
              <div className="shrink-0 border-b border-border bg-warn-bg/40 px-3 py-2 text-[12px] text-warn">
                <strong className="font-medium">
                  {formatCount(precisionLoss.length)} number
                  {precisionLoss.length === 1 ? '' : 's'} lose precision
                </strong>{' '}
                as JavaScript numbers — e.g. {precisionLoss[0]!.literal} becomes{' '}
                {precisionLoss[0]!.printed}. The formatted output is not safe to use.
              </div>
            )}

            {precisionLoss.length === 0 && reformatted.length > 0 && (
              <div className="shrink-0 border-b border-border px-3 py-2 text-[12px] text-muted">
                {formatCount(reformatted.length)} number
                {reformatted.length === 1 ? '' : 's'} keep their exact value but are printed
                differently — e.g. {reformatted[0]!.literal} becomes {reformatted[0]!.printed}.
              </div>
            )}

            {unescapeError !== null ? (
              <div className="flex-1 overflow-auto p-3 font-mono text-[13px] text-del scroll-thin">
                {unescapeError}
              </div>
            ) : !isTextMode && !valid && analysis.issues.length > 0 ? (
              <div className="flex-1 space-y-2 overflow-y-auto p-3 scroll-thin">
                {analysis.issues.map((issue) => (
                  <IssueCard key={`${issue.offset}:${issue.length}:${issue.code}`} issue={issue} />
                ))}
              </div>
            ) : (
              <CodeArea value={output} readOnly placeholder="Output appears here" />
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
