import { useDeferredValue, useMemo } from 'react'
import type { Remote } from 'comlink'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { IssueCard } from '@/components/ui/IssueCard'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatBytes, formatCount } from '@/lib/util/bytes'
import { useWorkerJob, type JobStatus } from '@/lib/worker/useWorkerJob'
import type {
  JsonTypesOptions,
  JsonTypesResult,
  Target,
  TypeNote,
} from '@fadeltd/devtools-core/json-types'
import { hasLongLine } from '@fadeltd/devtools-core/text'
import type { JsonTypesApi } from './json-types.worker'

interface State {
  text: string
  target: Target
  rootName: string
  declaration: 'interface' | 'type'
  inferTypes: boolean
  pointers: boolean
}

const INITIAL: State = {
  text: '',
  target: 'typescript',
  rootName: 'Root',
  declaration: 'interface',
  inferTypes: true,
  pointers: true,
}

const TARGETS: Record<Target, string> = { typescript: 'TypeScript', zod: 'Zod', go: 'Go' }

/** Notes about what the output had to approximate; everything else is info. */
const WARN_CODES = new Set<TypeNote['code']>(['big-integer', 'bad-go-tag', 'depth'])

interface Input {
  text: string
  options: JsonTypesOptions
}

// Module-level so useWorkerJob sees stable references.
function spawnWorker() {
  return new Worker(new URL('./json-types.worker.ts', import.meta.url), { type: 'module' })
}

function runInWorker(api: Remote<JsonTypesApi>, input: Input): Promise<JsonTypesResult> {
  return api.run(input.text, input.options)
}

function RunStatus({ status, error, onCancel }: { status: JobStatus; error: string | undefined; onCancel: () => void }) {
  switch (status) {
    case 'slow':
      return (
        <>
          <Badge tone="warn">Still running after 2s</Badge>
          <Button variant="danger" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )
    case 'cancelled':
      return (
        <Badge tone="del" title="Edit the input or an option to run again">
          Cancelled — output is from the last finished run
        </Badge>
      )
    case 'error':
      return <Badge tone="del">{error}</Badge>
    case 'running':
    case 'done':
      return null
  }
}

function NoteRow({ note }: { note: TypeNote }) {
  const warn = WARN_CODES.has(note.code)
  return (
    <li className="flex items-start gap-2 px-3 py-1.5">
      {warn ? (
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-label="Warning" />
      ) : (
        <Info size={13} className="mt-0.5 shrink-0 text-muted" aria-label="Note" />
      )}
      <div className="min-w-0 text-[12px]">
        {note.path !== null && (
          <span className="mr-1.5 font-mono text-[11px] wrap-break-word text-fg">{note.path}</span>
        )}
        <span className={warn ? 'text-warn' : 'text-muted'}>{note.message}</span>
      </div>
    </li>
  )
}

function readAs(result: JsonTypesResult): string | null {
  switch (result.flavor) {
    case 'json':
      return 'valid JSON'
    case 'jsonc':
      return 'JSON with comments'
    case 'ndjson':
      return `${formatCount(result.samples)} NDJSON lines`
    default:
      return null
  }
}

export default function JsonTypesTool() {
  useToolUsageTracker('json-types')
  const { state, setState, reset } = useToolState<State>('json-types', INITIAL)

  const deferred = useDeferredValue(state)
  const input = useMemo<Input>(
    () => ({
      text: deferred.text,
      options: {
        target: deferred.target,
        rootName: deferred.rootName,
        declaration: deferred.declaration,
        inferTypes: deferred.inferTypes,
        pointers: deferred.pointers,
      },
    }),
    [deferred],
  )
  const job = useWorkerJob(spawnWorker, runInWorker, input)
  const result = job.result
  const failed = result !== undefined && result.errors.length > 0
  const output = result === undefined || failed ? '' : result.output
  const status = result === undefined ? null : readAs(result)
  const noWrap = useMemo(() => hasLongLine(state.text), [state.text])

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'JSON to Types',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
  ])

  return (
    <ToolFrame
      slug="json-types"
      actions={
        <>
          <Select
            value={state.target}
            onChange={(e) => setState((p) => ({ ...p, target: e.target.value as Target }))}
            aria-label="Generate"
            title="Generate"
          >
            {(Object.keys(TARGETS) as Target[]).map((t) => (
              <option key={t} value={t}>
                {TARGETS[t]}
              </option>
            ))}
          </Select>

          <input
            className="min-h-11 w-32 shrink-0 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg md:min-h-7"
            value={state.rootName}
            placeholder="Root"
            onChange={(e) => setState((p) => ({ ...p, rootName: e.target.value }))}
            aria-label="Root type name"
            title="Root type name"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />

          {state.target === 'typescript' && (
            <Select
              value={state.declaration}
              onChange={(e) =>
                setState((p) => ({ ...p, declaration: e.target.value as State['declaration'] }))
              }
              aria-label="Declare as"
              title="Declare as"
            >
              <option value="interface">interface</option>
              <option value="type">type</option>
            </Select>
          )}
          {state.target === 'zod' && (
            <Toggle checked={state.inferTypes} onChange={(v) => setState((p) => ({ ...p, inferTypes: v }))}>
              z.infer types
            </Toggle>
          )}
          {state.target === 'go' && (
            <Toggle checked={state.pointers} onChange={(v) => setState((p) => ({ ...p, pointers: v }))}>
              Pointers for optional
            </Toggle>
          )}

          <RunStatus status={job.status} error={job.error} onCancel={job.cancel} />
          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        rightLabel={failed ? 'Problems' : TARGETS[state.target]}
        left={
          <div className="flex min-h-0 w-full flex-col">
            <CodeArea
              value={state.text}
              onChange={(e) => setState((p) => ({ ...p, text: e.target.value }))}
              placeholder="Paste a JSON sample, or NDJSON with one record per line…"
              aria-label="Input"
              wrap={noWrap ? 'off' : undefined}
            />
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
              <span>{formatBytes(new Blob([state.text]).size)}</span>
              {status !== null && !failed && (
                <span className="flex items-center gap-1 text-add">
                  <CheckCircle2 size={12} aria-hidden /> {status}
                </span>
              )}
              {result !== undefined && result.types > 0 && (
                <span>
                  {formatCount(result.types)} {result.types === 1 ? 'type' : 'types'}
                </span>
              )}
              {failed && (
                <Badge tone="del">
                  {formatCount(result.errors.length)} {result.errors.length === 1 ? 'problem' : 'problems'}
                </Badge>
              )}
            </div>
          </div>
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            {failed ? (
              <div className="flex-1 space-y-2 overflow-y-auto p-3 scroll-thin">
                {result.errors.map((issue) => (
                  <IssueCard key={`${issue.offset}:${issue.code}`} issue={issue} />
                ))}
              </div>
            ) : (
              <CodeArea
                value={output}
                readOnly
                // Code: a wrapped `z.infer<typeof …>` reads as two statements.
                wrap="off"
                placeholder={`${TARGETS[state.target]} types appear here`}
                aria-label="Output"
              />
            )}

            {/* Notes say where the output had to approximate; they have to be
                seen, not hovered for. */}
            {!failed && result !== undefined && result.notes.length > 0 && (
              <ul className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border py-1 scroll-thin">
                {result.notes.map((n) => (
                  <NoteRow key={`${n.code}:${n.path}:${n.message}`} note={n} />
                ))}
              </ul>
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
