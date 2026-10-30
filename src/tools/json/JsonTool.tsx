import { useDeferredValue, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle,
  ArrowUp,
  Braces,
  CheckCircle2,
  Download,
  GitCompare,
  ListFilter,
  Wand2,
  X,
} from 'lucide-react'
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
import { downloadBlob } from '@/lib/util/download'
import {
  analyze,
  type Analysis,
  assessJsonSize,
  outputHead,
  stripJsonc,
  type JsonIssue,
  embeddedFields,
  expandEmbedded,
  findEmbeddedJson,
  type EmbeddedField,
  type EmbeddedOptions,
  runFixes,
  losslessSupported,
  parseLossless,
  escapeAsJsonString,
  findNumberIssues,
  formatValue,
  minifyValue,
  ndjsonToArray,
  unescapeJsonString,
  withSortedKeys,
  type Indent,
  formatPath,
  selectPath,
  toJqPath,
  toJsonPointer,
  type PathSegment,
  type Selection,
} from '@fadeltd/devtools-core/json'
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
  /** Path the output is narrowed to, as typed; '' shows the whole document. */
  filter: string
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
  filter: '',
}

/** What the tool shows for input it refuses to parse: nothing at all. */
const NOT_ANALYSED: Analysis = { issues: [], flavor: 'empty', ndjson: null, moreIssues: false }

/**
 * Output longer than this never goes into the textarea whole: a 32 MB string
 * there freezes layout and makes select-all useless. Only the head is shown;
 * Copy and Download still get all of it.
 */
const OUTPUT_INLINE_MAX = 2 * 1024 * 1024
const OUTPUT_HEAD_CHARS = 100_000

const DOWNLOAD_NAMES: Record<Mode, string> = {
  format: 'formatted.json',
  minify: 'minified.json',
  escape: 'escaped.txt',
  unescape: 'unescaped.txt',
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

      <pre className="mt-2 overflow-x-auto font-mono text-[12px] leading-normal text-muted scroll-thin">
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

function FilterBar({
  value,
  selection,
  onChange,
}: {
  value: string
  selection: Selection
  onChange: (next: string) => void
}) {
  const narrowed = selection.ok && selection.path.length > 0
  return (
    <div className="shrink-0 border-b border-border px-3 py-1.5">
      <div className="flex items-center gap-2">
        <label
          htmlFor="json-filter"
          className="flex shrink-0 items-center gap-1 text-[12px] text-muted"
        >
          <ListFilter size={14} aria-hidden />
          Filter
        </label>
        <input
          id="json-filter"
          className={cn(
            'min-h-11 min-w-0 flex-1 rounded-[4px] border bg-bg px-2 font-mono text-fg placeholder:text-faint md:min-h-7',
            selection.ok ? 'border-border' : 'border-del/60',
          )}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder=".items[0] · items[0].id · /items/0"
          aria-invalid={!selection.ok}
          aria-describedby={selection.ok ? undefined : 'json-filter-error'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
        />
        {narrowed && (
          <Button
            variant="ghost"
            className="min-w-11 justify-center md:min-w-7"
            onClick={() => onChange(formatPath(selection.path.slice(0, -1), selection.flavor))}
            title="Widen to the parent node"
            aria-label="Up one level"
          >
            <ArrowUp size={14} aria-hidden />
          </Button>
        )}
        {value !== '' && (
          <Button
            variant="ghost"
            className="min-w-11 justify-center md:min-w-7"
            onClick={() => onChange('')}
            title="Show the whole document"
            aria-label="Clear filter"
          >
            <X size={14} aria-hidden />
          </Button>
        )}
      </div>
      {!selection.ok && (
        <p id="json-filter-error" className="mt-1 font-mono text-[11px] text-del">
          {selection.message}
        </p>
      )}
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

  // Size first, on the deferred text: one pass, no 20 MB encode per keystroke.
  // Above 1 MB the expensive extras are off; above 50 MB nothing is parsed.
  const size = useMemo(() => assessJsonSize(deferred.text), [deferred.text])
  const large = size.tier === 'large'
  const refused = size.tier === 'refuse'

  const analysis = useMemo(
    () =>
      refused ? NOT_ANALYSED : analyze(deferred.text, { lenient: deferred.lenient, tabWidth: 2 }),
    [refused, deferred.text, deferred.lenient],
  )

  // Kept in the large tier: it is a regex scan that stops at 500 hits (~50 ms
  // on 20 MB), and it is what warns that the output rounds a number.
  const numberIssues = useMemo(
    () => (refused ? [] : findNumberIssues(deferred.text)),
    [refused, deferred.text],
  )
  const precisionLoss = numberIssues.filter((n) => n.kind === 'precision')
  const reformatted = numberIssues.filter((n) => n.kind === 'reformatted')

  // Lossless mode: when the number gate trips, re-parse keeping those literals
  // as their source text, so format/minify/sort round-trip them byte-exactly.
  // Nothing in this tool does arithmetic on values, so nothing else changes.
  // Not for large input: the reviver runs once per value (~620 ms on 20 MB).
  const lossless = losslessSupported && numberIssues.length > 0 && !large
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
  // Not for large input: the scan walks every string in the document.
  const fields = useMemo(
    () =>
      parsed === undefined || large
        ? []
        : embeddedFields(findEmbeddedJson(parsed, embeddedOptions)),
    [parsed, large, embeddedOptions],
  )

  // Expansion is a view over the parsed value; the source text is untouched,
  // so toggling it off restores the original exactly. Sorting happens here too,
  // so the text output and the tree show the same document. A large document is
  // never expanded, even if expansion was left on from a smaller one.
  const { expandEmbedded: expandAll, expandPointers, sortKeys } = deferred
  const shown = useMemo(() => {
    if (parsed === undefined) return undefined
    const value = large
      ? parsed
      : expandAll
        ? expandEmbedded(parsed, embeddedOptions).value
        : expandPointers.length > 0
          ? expandEmbedded(parsed, { ...embeddedOptions, only: new Set(expandPointers) }).value
          : parsed
    return sortKeys ? withSortedKeys(value) : value
  }, [parsed, large, embeddedOptions, expandAll, expandPointers, sortKeys])

  // Narrowing runs last, on what the user sees: embedded payloads are already
  // expanded, so a path can reach inside one.
  const selection = useMemo<Selection | undefined>(
    () => (shown === undefined ? undefined : selectPath(shown, deferred.filter)),
    [shown, deferred.filter],
  )
  const focused = selection?.ok === true ? selection : undefined

  function setFilter(filter: string) {
    setState((p) => ({ ...p, filter }))
  }

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

  // Keyed on the fields it reads, not on `deferred`, so switching view or typing
  // a filter does not re-serialise a 20 MB document.
  const { text: deferredText, mode: deferredMode, indent } = deferred
  const { output, unescapeError } = useMemo((): { output: string; unescapeError: string | null } => {
    if (deferredText === '' || refused) return { output: '', unescapeError: null }

    if (deferredMode === 'escape') {
      return { output: escapeAsJsonString(deferredText, { ascii: false }), unescapeError: null }
    }
    if (deferredMode === 'unescape') {
      const r = unescapeJsonString(deferredText)
      return r.ok ? { output: r.value, unescapeError: null } : { output: '', unescapeError: r.message }
    }
    if (focused === undefined) return { output: '', unescapeError: null }

    return {
      output:
        deferredMode === 'minify'
          ? minifyValue(focused.value, { sortKeys: false })
          : formatValue(focused.value, { indent, sortKeys: false }),
      unescapeError: null,
    }
  }, [focused, deferredText, deferredMode, indent, refused])

  // Only the head of a long output enters the DOM.
  const outputCut = useMemo(() => {
    if (output.length <= OUTPUT_INLINE_MAX) return null
    return outputHead(output, OUTPUT_HEAD_CHARS)
  }, [output])
  const outputShown =
    outputCut === null
      ? output
      : `${outputCut.head}\n\n… ${formatCount(outputCut.omitted)} more characters. Use Copy or Download for the whole thing.`

  const isTextMode = state.mode === 'escape' || state.mode === 'unescape'
  const valid = analysis.flavor === 'json' || analysis.flavor === 'jsonc'
  const showTree = state.mode === 'format' && state.view === 'tree' && valid

  // Only worth running on a document that does not parse. Counts are exact:
  // each fix sees the previous one's output. Not for large input: every fix
  // tokenises the whole text (~1.5 s for the set on 20 MB).
  const fixes = useMemo(
    () =>
      size.tier === 'ok' && (analysis.flavor === 'invalid' || analysis.flavor === 'ndjson')
        ? runFixes(deferredText)
        : null,
    [size.tier, analysis.flavor, deferredText],
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
        rightLabel={isTextMode || valid || refused ? 'Output' : 'Problems'}
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
              <span>{formatBytes(size.bytes)}</span>
              {size.tier !== 'ok' && (
                <Badge tone={refused ? 'del' : 'warn'}>{refused ? 'too large to parse' : 'large'}</Badge>
              )}
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
                  {formatCount(analysis.issues.length)}
                  {analysis.moreIssues ? '+' : ''}{' '}
                  {analysis.issues.length === 1 && !analysis.moreIssues ? 'problem' : 'problems'}
                </Badge>
              )}
            </div>
          </div>
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            {/* Not dismissable: the tool is doing less than usual, and that
                has to stay visible for as long as it is true. */}
            {size.reason !== null && (
              <div
                role="status"
                className={cn(
                  'flex shrink-0 items-start gap-2 border-b border-border px-3 py-2 text-[12px]',
                  refused ? 'bg-del-bg/40 text-del' : 'bg-warn-bg/40 text-warn',
                )}
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>{size.reason}</span>
              </div>
            )}

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
                {large && ' Lossless mode is off for large input.'}
              </div>
            )}

            {!lossless && precisionLoss.length === 0 && reformatted.length > 0 && (
              <div className="shrink-0 border-b border-border px-3 py-2 text-[12px] text-muted">
                {formatCount(reformatted.length)} number
                {reformatted.length === 1 ? '' : 's'} keep their exact value but are printed
                differently — e.g. {reformatted[0]!.literal} becomes {reformatted[0]!.printed}.
              </div>
            )}

            {!isTextMode && valid && selection !== undefined && (
              <FilterBar value={state.filter} selection={selection} onChange={setFilter} />
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
                {analysis.moreIssues && (
                  <p className="text-[12px] text-faint">
                    Showing the first {formatCount(analysis.issues.length)} problems. Fix these and
                    the rest will be listed.
                  </p>
                )}
              </div>
            ) : showTree && focused !== undefined ? (
              <TreeView
                // A new subtree opens with its own default expansion.
                key={toJsonPointer(focused.path)}
                value={focused.value}
                basePath={focused.path}
                onFilter={(path: PathSegment[]) => setFilter(toJqPath(path))}
              />
            ) : refused ? (
              <div className="flex-1 p-3 text-[12px] text-muted">
                Nothing is parsed at this size. The input stays in the editor on the left,
                untouched.
              </div>
            ) : (
              <>
                <CodeArea
                  value={outputShown}
                  readOnly
                  placeholder={selection?.ok === false ? 'Nothing at this path' : 'Output appears here'}
                />
                {outputCut !== null && (
                  <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
                    <Badge title="The full text is not shown, to keep the page responsive">
                      showing {formatCount(outputCut.head.length)} of{' '}
                      {formatCount(output.length)} characters
                    </Badge>
                    <span className="flex-1" />
                    <CopyButton value={output} />
                    <Button
                      onClick={() =>
                        downloadBlob(
                          new Blob([output], {
                            type: DOWNLOAD_NAMES[deferredMode].endsWith('.json')
                              ? 'application/json'
                              : 'text/plain',
                          }),
                          DOWNLOAD_NAMES[deferredMode],
                        )
                      }
                    >
                      <Download size={14} aria-hidden />
                      Download
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
