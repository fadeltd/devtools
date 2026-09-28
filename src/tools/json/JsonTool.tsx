import { useDeferredValue, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, Braces, CheckCircle2, GitCompare, Wand2 } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { handOff } from '@/lib/persist/handoff'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatBytes, formatCount } from '@/lib/util/bytes'
import { cn } from '@/lib/util/cn'
import { analyze, stripJsonc, type JsonIssue } from './core/errors'
import {
  embeddedFields,
  expandEmbedded,
  findEmbeddedJson,
  type EmbeddedField,
  type EmbeddedOptions,
} from './core/embedded'
import { runFixes } from './core/fixes'
import { losslessSupported, parseLossless } from './core/rawjson'
import {
  escapeAsJsonString,
  findNumberIssues,
  formatValue,
  minifyValue,
  ndjsonToArray,
  unescapeJsonString,
  withSortedKeys,
  type Indent,
} from './core/format'
import { TreeView } from './TreeView'

type Mode = 'format' | 'minify' | 'escape' | 'unescape'
type View = 'text' | 'tree'

const VIEWS = [
  { value: 'text', label: 'Text' },
  { value: 'tree', label: 'Tree' },
] as const

interface State {
  text: string
  mode: Mode
  indent: Indent
  sortKeys: boolean
  lenient: boolean
  /** Expand every embedded JSON string. */
  expandEmbedded: boolean
  /** When not expanding all: the pointers picked one by one. */
  expandPointers: string[]
  view: View
}

const INITIAL: State = {
  text: '',
  mode: 'format',
  indent: 2,
  sortKeys: false,
  lenient: false,
  expandEmbedded: false,
  expandPointers: [],
  view: 'text',
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

const CHIP_LIMIT = 6

function EmbeddedPanel({
  fields,
  isActive,
  anyActive,
  onToggle,
  onAll,
}: {
  fields: readonly EmbeddedField[]
  isActive: (pointer: string) => boolean
  anyActive: boolean
  onToggle: (pointer: string) => void
  onAll: (expand: boolean) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const activeCount = fields.filter((f) => isActive(f.pointer)).length
  const visible = showAll ? fields : fields.slice(0, CHIP_LIMIT)

  return (
    <div className="shrink-0 border-b border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Braces size={14} className="shrink-0 text-accent" aria-hidden />
        <span className="text-[12px]">
          {activeCount > 0 ? `Expanded ${formatCount(activeCount)} of ` : 'Found '}
          <strong className="font-medium">
            {formatCount(fields.length)} embedded JSON {fields.length === 1 ? 'string' : 'strings'}
          </strong>
          {fields.some((f) => f.parent !== null) && ' (some double-encoded)'}
        </span>
        <Button onClick={() => onAll(!anyActive)}>
          <Wand2 size={14} aria-hidden />
          {anyActive ? 'Show original' : 'Expand all'}
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {visible.map((f) => {
          const active = isActive(f.pointer)
          // A field inside another payload only exists once that one is open.
          const blocked = f.parent !== null && !isActive(f.parent)
          return (
            <button
              key={f.pointer}
              type="button"
              aria-pressed={active}
              disabled={blocked}
              onClick={() => onToggle(f.pointer)}
              title={
                blocked
                  ? `Inside ${f.parent === '' ? '(root)' : f.parent} — expand that first`
                  : `${f.pointer === '' ? '(root)' : f.pointer} — ${formatCount(f.rawLength)} characters`
              }
              className={cn(
                'min-h-11 rounded-[4px] border px-1.5 font-mono text-[11px] transition-colors md:min-h-0 md:py-px',
                'disabled:cursor-not-allowed disabled:opacity-40',
                active
                  ? 'border-border-strong bg-surface-2 text-fg'
                  : 'border-border bg-bg text-muted hover:text-fg',
              )}
            >
              {f.dotPath}
            </button>
          )
        })}
        {fields.length > CHIP_LIMIT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="min-h-11 px-1 font-mono text-[11px] text-faint hover:text-fg md:min-h-0"
          >
            {showAll ? 'show fewer' : `+${formatCount(fields.length - CHIP_LIMIT)} more`}
          </button>
        )}
      </div>
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

  // Lossless mode: when the number gate trips, re-parse keeping those literals
  // as their source text, so format/minify/sort round-trip them byte-exactly.
  // Nothing in this tool does arithmetic on values, so nothing else changes.
  const lossless = losslessSupported && numberIssues.length > 0
  const parsed = useMemo(() => {
    if (analysis.value === undefined || !lossless) return analysis.value
    try {
      return parseLossless(analysis.flavor === 'jsonc' ? stripJsonc(deferred.text) : deferred.text)
    } catch {
      return analysis.value
    }
  }, [analysis, lossless, deferred.text])
  const embeddedOptions = useMemo<EmbeddedOptions>(
    () => (lossless ? { parse: parseLossless } : {}),
    [lossless],
  )

  // Structured logs put their payload in a string, often double-encoded. Finding
  // those is the difference between reading this document here and copying a
  // field into another tab twice.
  const fields = useMemo(
    () => (parsed === undefined ? [] : embeddedFields(findEmbeddedJson(parsed, embeddedOptions))),
    [parsed, embeddedOptions],
  )

  // Expansion is a view over the parsed value; the source text is untouched,
  // so toggling it off restores the original exactly. Sorting happens here too,
  // so the text output and the tree show the same document.
  const shown = useMemo(() => {
    if (parsed === undefined) return undefined
    const { expandEmbedded: all, expandPointers } = deferred
    const value = all
      ? expandEmbedded(parsed, embeddedOptions).value
      : expandPointers.length > 0
        ? expandEmbedded(parsed, { ...embeddedOptions, only: new Set(expandPointers) }).value
        : parsed
    return deferred.sortKeys ? withSortedKeys(value) : value
  }, [parsed, embeddedOptions, deferred])

  const isFieldActive = (pointer: string) =>
    state.expandEmbedded || state.expandPointers.includes(pointer)
  const anyFieldActive = fields.some((f) => isFieldActive(f.pointer))

  function toggleField(pointer: string) {
    setState((p) => {
      const current = p.expandEmbedded ? fields.map((f) => f.pointer) : p.expandPointers
      const next = current.includes(pointer)
        ? current.filter((x) => x !== pointer)
        : [...current, pointer]
      return { ...p, expandEmbedded: false, expandPointers: next }
    })
  }

  function setAllFields(expand: boolean) {
    setState((p) => ({ ...p, expandEmbedded: expand, expandPointers: [] }))
  }

  const output = useMemo(() => {
    const { text, mode, indent } = deferred
    if (text === '') return ''

    if (mode === 'escape') return escapeAsJsonString(text, { ascii: false })
    if (mode === 'unescape') {
      const r = unescapeJsonString(text)
      return r.ok ? r.value : ''
    }
    if (shown === undefined) return ''

    return mode === 'minify'
      ? minifyValue(shown, { sortKeys: false })
      : formatValue(shown, { indent, sortKeys: false })
  }, [shown, deferred])

  const unescapeError =
    deferred.mode === 'unescape' && deferred.text !== ''
      ? (() => {
          const r = unescapeJsonString(deferred.text)
          return r.ok ? null : r.message
        })()
      : null

  const isTextMode = state.mode === 'escape' || state.mode === 'unescape'
  const valid = analysis.flavor === 'json' || analysis.flavor === 'jsonc'
  const showTree = state.mode === 'format' && state.view === 'tree' && valid && shown !== undefined

  // Only worth running on a document that does not parse. Counts are exact:
  // each fix sees the previous one's output.
  const fixes = useMemo(
    () =>
      analysis.flavor === 'invalid' || analysis.flavor === 'ndjson' ? runFixes(deferred.text) : null,
    [analysis.flavor, deferred.text],
  )
  const fixable = fixes !== null && fixes.applied.length > 0
  const fixesYieldJson = useMemo(() => {
    if (!fixable) return false
    try {
      JSON.parse(fixes.text)
      return true
    } catch {
      return false
    }
  }, [fixable, fixes])
  const lenientWouldHelp =
    fixes?.applied.some((f) => f.id === 'comments' || f.id === 'trailingCommas') === true

  const navigate = useNavigate()
  const [handOffFailed, setHandOffFailed] = useState(false)

  async function reviewInDiff() {
    if (fixes === null) return
    const ok = await handOff<{ left: string; right: string }>('diff', {
      left: state.text,
      right: fixes.text,
    })
    setHandOffFailed(!ok)
    if (ok) void navigate('/diff')
  }

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

          {state.mode === 'format' && (
            <Segmented
              value={state.view}
              options={VIEWS}
              onChange={(view) => setState((p) => ({ ...p, view }))}
            />
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
              {fields.length > 0 && (
                <Toggle checked={anyFieldActive} onChange={setAllFields}>
                  Expand embedded JSON
                </Toggle>
              )}
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

            {fixable && !isTextMode && (
              <div className="shrink-0 border-b border-border px-3 py-2">
                <div className="flex items-start gap-2">
                  <Wand2 size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                  <span className="text-[12px]">
                    <strong className="font-medium">
                      {fixesYieldJson ? 'Fixable' : 'Partly fixable'}:
                    </strong>{' '}
                    <span className="text-muted">
                      {fixes.applied.map((f) => f.label).join(' · ')}
                    </span>
                    {!fixesYieldJson && (
                      <span className="text-faint"> — some problems will remain</span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Button onClick={() => applyToInput(fixes.text)}>
                    <Wand2 size={14} aria-hidden />
                    Apply {fixes.applied.length === 1 ? 'fix' : 'fixes'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void reviewInDiff()}
                    title="Open the original and the fixed text side by side in Diff. Replaces what is in Diff now."
                  >
                    <GitCompare size={14} aria-hidden />
                    Review in Diff
                  </Button>
                  {lenientWouldHelp && !state.lenient && (
                    <Button
                      variant="ghost"
                      onClick={() => setState((p) => ({ ...p, lenient: true }))}
                    >
                      Allow comments / trailing commas
                    </Button>
                  )}
                  {handOffFailed && (
                    <span className="text-[12px] text-del">Could not open Diff.</span>
                  )}
                </div>
              </div>
            )}

            {/* The whole point of the feature is that you did not know the
                payload was in there. It has to announce itself. */}
            {fields.length > 0 && !isTextMode && (
              <EmbeddedPanel
                fields={fields}
                isActive={isFieldActive}
                anyActive={anyFieldActive}
                onToggle={toggleField}
                onAll={setAllFields}
              />
            )}

            {lossless && valid && (
              <div className="shrink-0 border-b border-border px-3 py-2 text-[12px] text-muted">
                <strong className="font-medium text-fg">Lossless mode.</strong>{' '}
                {precisionLoss.length > 0
                  ? `${formatCount(precisionLoss.length)} number${precisionLoss.length === 1 ? '' : 's'} (e.g. ${precisionLoss[0]!.literal}) cannot be held as a JavaScript number, so`
                  : 'To keep the output byte-exact,'}{' '}
                numbers are passed through exactly as written — never rounded or reprinted.
              </div>
            )}

            {!lossless && precisionLoss.length > 0 && (
              <div className="shrink-0 border-b border-border bg-warn-bg/40 px-3 py-2 text-[12px] text-warn">
                <strong className="font-medium">
                  {formatCount(precisionLoss.length)} number
                  {precisionLoss.length === 1 ? '' : 's'} lose precision
                </strong>{' '}
                as JavaScript numbers — e.g. {precisionLoss[0]!.literal} becomes{' '}
                {precisionLoss[0]!.printed}. The formatted output is not safe to use.
              </div>
            )}

            {!lossless && precisionLoss.length === 0 && reformatted.length > 0 && (
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
            ) : showTree ? (
              <TreeView value={shown} />
            ) : (
              <CodeArea value={output} readOnly placeholder="Output appears here" />
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
