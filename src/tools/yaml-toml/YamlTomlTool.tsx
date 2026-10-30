import type { Remote } from 'comlink'
import { useDeferredValue, useMemo } from 'react'
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Info } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatBytes, formatCount } from '@/lib/util/bytes'
import { useWorkerJob } from '@/lib/worker/useWorkerJob'
import type {
  ConvertResult,
  Format,
  Indent,
  Message,
  SourceFormat,
} from '@fadeltd/devtools-core/yaml-toml'
import { utf8Length } from '@fadeltd/devtools-core/text'
import type { YamlTomlApi, YamlTomlRunInput } from './yaml-toml.worker'

interface State {
  text: string
  from: SourceFormat
  to: Format
  indent: Indent
  /** Which document of a multi-document YAML stream; 'all' for every one. */
  document: 'all' | number
}

const INITIAL: State = { text: '', from: 'auto', to: 'json', indent: 2, document: 'all' }

const NAMES: Record<Format, string> = { json: 'JSON', yaml: 'YAML', toml: 'TOML' }

const INDENTS: Record<Format, ReadonlyArray<{ value: Indent; label: string }>> = {
  json: [
    { value: 2, label: '2 spaces' },
    { value: 4, label: '4 spaces' },
    { value: 'tab', label: 'Tabs' },
    { value: 'minify', label: 'Minified' },
  ],
  // YAML cannot indent with tabs, and has no minified form.
  yaml: [
    { value: 2, label: '2 spaces' },
    { value: 4, label: '4 spaces' },
  ],
  toml: [],
}

/** Before the first run settles: nothing to show, nothing wrong. */
const EMPTY: ConvertResult = { output: '', detected: null, documents: 0, errors: [], warnings: [], notes: [] }

// Module-level so useWorkerJob sees stable references.
function spawnConverter() {
  return new Worker(new URL('./yaml-toml.worker.ts', import.meta.url), { type: 'module' })
}

function runInWorker(api: Remote<YamlTomlApi>, input: YamlTomlRunInput): Promise<ConvertResult> {
  return api.run(input)
}

function parseIndent(v: string): Indent {
  if (v === 'tab' || v === 'minify') return v
  return v === '4' ? 4 : 2
}

/** Unique per result: the engine drops exact repeats. */
function messageKey(m: Message): string {
  return `${m.code}:${m.line}:${m.column}:${m.message}`
}

/** Same card as the JSON tool's: message, position, and a caret under the spot. */
function IssueCard({ issue }: { issue: Message }) {
  const snippet = issue.snippet
  const gutterWidth = String(snippet?.lines[snippet.lines.length - 1]?.number ?? 1).length

  return (
    <div className="panel p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-px shrink-0 text-del" aria-hidden />
        <div className="min-w-0">
          <div className="text-[13px] font-medium wrap-break-word text-fg">{issue.message}</div>
          {issue.line !== null && (
            <div className="font-mono text-[11px] text-faint">
              line {issue.line}, column {issue.column}
            </div>
          )}
        </div>
      </div>

      {snippet !== null && (
        <pre className="mt-2 overflow-x-auto font-mono text-[12px] leading-normal text-muted scroll-thin">
          {snippet.lines.map((l) => (
            <span key={l.number}>
              <span className={l.number === snippet.caretLine ? 'text-fg' : undefined}>
                {String(l.number).padStart(gutterWidth, ' ')} │ {l.text}
              </span>
              {'\n'}
              {l.number === snippet.caretLine && (
                <span className="text-del">
                  {' '.repeat(gutterWidth)} │ {' '.repeat(Math.max(0, snippet.caretColumn - 1))}▲
                  {'\n'}
                </span>
              )}
            </span>
          ))}
        </pre>
      )}

      {issue.hint !== null && <p className="mt-1 text-[12px] text-muted">{issue.hint}</p>}
    </div>
  )
}

function NoteRow({ note, tone }: { note: Message; tone: 'warn' | 'note' }) {
  return (
    <li className="flex items-start gap-2 px-3 py-1.5">
      {tone === 'warn' ? (
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-label="Warning" />
      ) : (
        <Info size={13} className="mt-0.5 shrink-0 text-muted" aria-label="Note" />
      )}
      <div className="min-w-0 text-[12px]">
        <span className={tone === 'warn' ? 'text-warn' : 'text-fg'}>{note.message}</span>
        {note.line !== null && (
          <span className="ml-1.5 font-mono text-[11px] text-faint">
            {note.line}:{note.column}
          </span>
        )}
        {note.hint !== null && <span className="block text-muted">{note.hint}</span>}
      </div>
    </li>
  )
}

export default function YamlTomlTool() {
  useToolUsageTracker('yaml-toml')
  const { state, setState, reset } = useToolState<State>('yaml-toml', INITIAL)

  // Keeps typing responsive: the worker and the byte count run against a
  // deferred snapshot, never the keystroke itself.
  const deferredText = useDeferredValue(state.text)
  const input = useMemo<YamlTomlRunInput>(
    () => ({
      text: deferredText,
      from: state.from,
      to: state.to,
      indent: state.indent,
      document: state.document,
    }),
    [deferredText, state.from, state.to, state.indent, state.document],
  )
  const job = useWorkerJob(spawnConverter, runInWorker, input)
  // The last finished result is kept while a newer run is in flight.
  const result = job.result ?? EMPTY
  const bytes = useMemo(() => utf8Length(deferredText), [deferredText])

  const failed = result.errors.length > 0
  const output = failed ? '' : result.output
  const indents = INDENTS[state.to]
  // YAML falls back to 2 for tabs/minified; show what is actually used.
  const shownIndent = indents.some((i) => i.value === state.indent) ? state.indent : 2
  const pickedDocument =
    typeof state.document === 'number' && state.document < result.documents ? state.document : 'all'

  /**
   * Swap the direction. A successful output becomes the new input, so the
   * conversion can be checked by running it back.
   */
  function swap() {
    setState((p) => ({
      ...p,
      text: output !== '' ? output : p.text,
      from: p.to,
      to: p.from === 'auto' ? (result.detected ?? 'json') : p.from,
      document: 'all',
    }))
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'YAML / JSON / TOML',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
  ])

  const notes = [
    ...result.warnings.map((m) => ({ m, tone: 'warn' as const })),
    ...result.notes.map((m) => ({ m, tone: 'note' as const })),
  ]

  return (
    <ToolFrame
      slug="yaml-toml"
      actions={
        <>
          <Select
            value={state.from}
            onChange={(e) =>
              setState((p) => ({ ...p, from: e.target.value as SourceFormat, document: 'all' }))
            }
            aria-label="Convert from"
            title="Convert from"
          >
            <option value="auto">
              {state.from === 'auto' && result.detected !== null
                ? `Auto (${NAMES[result.detected]})`
                : 'Auto-detect'}
            </option>
            <option value="yaml">From YAML</option>
            <option value="json">From JSON</option>
            <option value="toml">From TOML</option>
          </Select>

          <Button
            variant="ghost"
            className="min-w-11 justify-center md:min-w-7"
            onClick={swap}
            title="Swap direction, moving the output into the input"
            aria-label="Swap direction"
          >
            <ArrowLeftRight size={14} aria-hidden />
          </Button>

          <Select
            value={state.to}
            onChange={(e) => setState((p) => ({ ...p, to: e.target.value as Format }))}
            aria-label="Convert to"
            title="Convert to"
          >
            <option value="yaml">To YAML</option>
            <option value="json">To JSON</option>
            <option value="toml">To TOML</option>
          </Select>

          {indents.length > 0 && (
            <Select
              value={String(shownIndent)}
              onChange={(e) => setState((p) => ({ ...p, indent: parseIndent(e.target.value) }))}
              aria-label="Indent"
              title="Indent"
            >
              {indents.map((i) => (
                <option key={String(i.value)} value={String(i.value)}>
                  {i.label}
                </option>
              ))}
            </Select>
          )}

          {result.documents > 1 && (
            <Select
              value={String(pickedDocument)}
              onChange={(e) =>
                setState((p) => ({
                  ...p,
                  document: e.target.value === 'all' ? 'all' : Number(e.target.value),
                }))
              }
              aria-label="Document"
              title="Which YAML document to convert"
            >
              <option value="all">
                All {formatCount(result.documents)} documents
              </option>
              {Array.from({ length: result.documents }, (_, i) => (
                <option key={i} value={String(i)}>
                  Document {i + 1}
                </option>
              ))}
            </Select>
          )}

          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        rightLabel={failed ? 'Problems' : 'Output'}
        left={
          <div className="flex min-h-0 w-full flex-col">
            <CodeArea
              value={state.text}
              onChange={(e) => setState((p) => ({ ...p, text: e.target.value }))}
              placeholder="Paste YAML, JSON or TOML…"
              aria-label="Input"
            />
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
              <span>{formatBytes(bytes)}</span>
              {result.detected !== null && !failed && (
                <span className="flex items-center gap-1 text-add">
                  <CheckCircle2 size={12} aria-hidden /> valid {NAMES[result.detected]}
                </span>
              )}
              {result.documents > 1 && <span>{formatCount(result.documents)} documents</span>}
              {failed && (
                <Badge tone="del">
                  {formatCount(result.errors.length)}{' '}
                  {result.errors.length === 1 ? 'problem' : 'problems'}
                  {result.detected !== null && ` · ${NAMES[result.detected]}`}
                </Badge>
              )}
              {job.status === 'slow' && (
                <>
                  <Badge tone="warn">Still converting after 2s</Badge>
                  <Button variant="danger" onClick={job.cancel}>
                    Cancel
                  </Button>
                </>
              )}
              {job.status === 'cancelled' && (
                <Badge tone="del" title="Edit the input or an option to run again">
                  Cancelled — showing the last finished result
                </Badge>
              )}
              {job.status === 'error' && <Badge tone="del">{job.error}</Badge>}
            </div>
          </div>
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            {failed ? (
              <div className="flex-1 space-y-2 overflow-y-auto p-3 scroll-thin">
                {result.errors.map((issue) => (
                  <IssueCard key={messageKey(issue)} issue={issue} />
                ))}
              </div>
            ) : (
              <CodeArea
                value={output}
                readOnly
                placeholder={`${NAMES[state.to]} appears here`}
                aria-label="Output"
              />
            )}

            {/* Notes say what the conversion did on the user's behalf (aliases
                expanded, dates stringified); they have to be seen, not
                hovered for. */}
            {notes.length > 0 && (
              <ul className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border py-1 scroll-thin">
                {notes.map(({ m, tone }) => (
                  <NoteRow key={messageKey(m)} note={m} tone={tone} />
                ))}
              </ul>
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
