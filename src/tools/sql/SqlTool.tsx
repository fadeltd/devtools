import type { Remote } from 'comlink'
import { useDeferredValue, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
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
import { formatBytes } from '@/lib/util/bytes'
import { useWorkerJob } from '@/lib/worker/useWorkerJob'
import {
  SQL_DIALECTS,
  type SqlDialect,
  type SqlError,
  type SqlIndent,
  type SqlKeywordCase,
  type SqlResult,
} from '@fadeltd/devtools-core/sql'
import type { SqlApi, SqlJob } from './sql.worker'

type Mode = SqlJob['mode']

type State = SqlJob

const INITIAL: State = {
  text: '',
  mode: 'format',
  dialect: 'sql',
  keywordCase: 'preserve',
  indent: 2,
  linesBetweenQueries: 1,
  stripComments: false,
}

const MODES = [
  { value: 'format', label: 'Format' },
  { value: 'minify', label: 'Minify' },
] as const

const CASES = [
  { value: 'preserve', label: 'Preserve', title: 'Keep keywords as typed' },
  { value: 'upper', label: 'UPPER', title: 'Uppercase keywords' },
  { value: 'lower', label: 'lower', title: 'Lowercase keywords' },
] as const satisfies readonly { value: SqlKeywordCase; label: string; title: string }[]

// Module-level so useWorkerJob sees stable references.
function spawnSql() {
  return new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module' })
}

function runInWorker(api: Remote<SqlApi>, job: SqlJob): Promise<SqlResult> {
  return api.run(job)
}

function ErrorLine({ error }: { error: SqlError }) {
  return (
    <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-border bg-del-bg/40 px-3 py-2">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-del" aria-hidden />
      <div className="min-w-0">
        <p className="wrap-break-word font-mono text-[12px] text-fg">
          {error.line !== null && (
            <span className="text-del">
              Line {error.line}
              {error.column !== null && `, column ${error.column}`}:{' '}
            </span>
          )}
          {error.message}
        </p>
        {error.hint !== null && <p className="mt-0.5 text-[12px] text-muted">{error.hint}</p>}
      </div>
    </div>
  )
}

export default function SqlTool() {
  useToolUsageTracker('sql')
  const { state, setState, reset } = useToolState<State>('sql', INITIAL)

  // The worker runs against a deferred snapshot, so typing stays responsive and
  // a run in flight is superseded rather than queued.
  const deferred = useDeferredValue(state)
  const job = useWorkerJob(spawnSql, runInWorker, deferred)
  const result = job.result
  const output = result?.ok === true ? result.output : ''
  const error = result?.ok === false ? result.error : null

  // Blank input and minify never import sql-formatter, so "a run has finished"
  // is not "the formatter is loaded". Only the first real format run pays for
  // the ~80 kB chunk; that is the wait worth naming.
  const [formatterLoaded, setFormatterLoaded] = useState(false)
  if (
    !formatterLoaded &&
    job.status === 'done' &&
    deferred.mode === 'format' &&
    deferred.text.trim() !== ''
  ) {
    setFormatterLoaded(true)
  }
  const loadingFormatter =
    !formatterLoaded &&
    (job.status === 'running' || job.status === 'slow') &&
    state.mode === 'format' &&
    state.text.trim() !== ''

  const sizes = useMemo(() => {
    if (state.text === '' || output === '') return null
    return `${formatBytes(new Blob([state.text]).size)} → ${formatBytes(new Blob([output]).size)}`
  }, [state.text, output])

  function set<K extends keyof State>(key: K, value: State[K]) {
    setState((p) => ({ ...p, [key]: value }))
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'SQL Formatter',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
    {
      combo: 'mod+shift+f',
      label: 'Format',
      group: 'SQL Formatter',
      scope: 'tool',
      whileTyping: true,
      run: () => set('mode', 'format'),
    },
  ])

  const formatting = state.mode === 'format'

  return (
    <ToolFrame
      slug="sql"
      actions={
        <>
          <Segmented<Mode> value={state.mode} options={MODES} onChange={(v) => set('mode', v)} />
          <Select
            value={state.dialect}
            onChange={(e) => set('dialect', e.target.value as SqlDialect)}
            title="Dialect"
            aria-label="Dialect"
          >
            {SQL_DIALECTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
          {formatting ? (
            <>
              <Segmented<SqlKeywordCase>
                value={state.keywordCase}
                options={CASES}
                onChange={(v) => set('keywordCase', v)}
              />
              <Select
                value={String(state.indent)}
                onChange={(e) =>
                  set(
                    'indent',
                    e.target.value === 'tab' ? 'tab' : (Number(e.target.value) as SqlIndent),
                  )
                }
                title="Indent"
                aria-label="Indent"
              >
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="tab">Tabs</option>
              </Select>
              <Select
                value={String(state.linesBetweenQueries)}
                onChange={(e) => set('linesBetweenQueries', Number(e.target.value))}
                title="Blank lines between statements"
                aria-label="Blank lines between statements"
              >
                <option value="0">No blank line</option>
                <option value="1">1 blank line</option>
                <option value="2">2 blank lines</option>
              </Select>
            </>
          ) : (
            <Toggle checked={state.stripComments} onChange={(v) => set('stripComments', v)}>
              Strip comments
            </Toggle>
          )}
          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel="SQL"
        rightLabel={formatting ? 'Formatted' : 'Minified'}
        left={
          <CodeArea
            value={state.text}
            onChange={(e) => set('text', e.target.value)}
            placeholder="Paste SQL — a query, a migration, or a dump…"
          />
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            {error !== null && <ErrorLine error={error} />}
            <CodeArea
              value={output}
              readOnly
              placeholder={error !== null ? 'Fix the error to see output' : 'Output appears here'}
            />
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
              {sizes !== null && <span>{sizes}</span>}
              {loadingFormatter && <span role="status">Loading formatter…</span>}
              {job.status === 'slow' && (
                <>
                  <Badge tone="warn">Still working after 2s</Badge>
                  <Button variant="danger" onClick={job.cancel}>
                    Cancel
                  </Button>
                </>
              )}
              {job.status === 'cancelled' && (
                <Badge tone="del" title="Edit the input or an option to run again">
                  Cancelled — output is from the last finished run
                </Badge>
              )}
              {job.status === 'error' && <Badge tone="del">{job.error}</Badge>}
            </div>
          </div>
        }
      />
    </ToolFrame>
  )
}
