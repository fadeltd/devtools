import type { Remote } from 'comlink'
import { useDeferredValue, useMemo, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
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
import type { CssError, CssParser, CssResult } from '@fadeltd/devtools-core/css'
import type { CssApi, CssJob } from './css.worker'

type Mode = CssJob['mode']
type State = CssJob

const INITIAL: State = {
  text: '',
  mode: 'format',
  parser: 'css',
  printWidth: 80,
  indent: 2,
  singleQuote: false,
}

const MODES = [
  { value: 'format', label: 'Format' },
  { value: 'minify', label: 'Minify' },
] as const

const PARSERS = [
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'less', label: 'Less' },
] as const satisfies readonly { value: CssParser; label: string }[]

// Module-level so useWorkerJob sees stable references.
function spawnCss() {
  return new Worker(new URL('./css.worker.ts', import.meta.url), { type: 'module' })
}

function runInWorker(api: Remote<CssApi>, job: CssJob): Promise<CssResult> {
  return api.run(job)
}

function ErrorLine({ error }: { error: CssError }) {
  return (
    <div
      role="alert"
      className="flex shrink-0 items-start gap-2 border-b border-border bg-del-bg/40 px-3 py-2"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-del" aria-hidden />
      <p className="min-w-0 wrap-break-word font-mono text-[12px] text-fg">
        {error.line !== null && (
          <span className="text-del">
            Line {error.line}
            {error.column !== null && `, column ${error.column}`}:{' '}
          </span>
        )}
        {error.message}
      </p>
    </div>
  )
}

export default function CssTool() {
  useToolUsageTracker('css')
  const { state, setState, reset } = useToolState<State>('css', INITIAL)

  // Minify is a hand-written CSS tokenizer; SCSS and Less have `//` comments,
  // interpolation and mixins it does not understand, so it refuses them
  // rather than produce something subtly broken.
  const cssOnly = state.mode === 'minify' && state.parser !== 'css'

  // The worker runs against a deferred snapshot, so typing stays responsive and
  // a run in flight is superseded rather than queued.
  const deferred = useDeferredValue(state)
  const job = useWorkerJob(spawnCss, runInWorker, deferred)
  const result = cssOnly ? undefined : job.result
  const output = result?.ok === true ? result.output : ''
  const error = result?.ok === false ? result.error : null

  // Blank input and minify never import Prettier, so "a run has finished" is
  // not "the formatter is loaded". Only the first real format run pays for the
  // ~70 kB chunk; that is the wait worth naming.
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
      group: 'CSS Formatter',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
    {
      combo: 'mod+shift+f',
      label: 'Format',
      group: 'CSS Formatter',
      scope: 'tool',
      whileTyping: true,
      run: () => set('mode', 'format'),
    },
  ])

  const formatting = state.mode === 'format'

  return (
    <ToolFrame
      slug="css"
      actions={
        <>
          <Segmented<Mode> value={state.mode} options={MODES} onChange={(v) => set('mode', v)} />
          <Select
            value={state.parser}
            onChange={(e) => set('parser', e.target.value as CssParser)}
            title="Language"
            aria-label="Language"
          >
            {PARSERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          {formatting && (
            <>
              <Select
                value={String(state.indent)}
                onChange={(e) =>
                  set(
                    'indent',
                    e.target.value === 'tab' ? 'tab' : (Number(e.target.value) as 2 | 4),
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
                value={String(state.printWidth)}
                onChange={(e) => set('printWidth', Number(e.target.value))}
                title="Wrap long values at this many columns"
                aria-label="Print width"
              >
                <option value="80">80 columns</option>
                <option value="100">100 columns</option>
                <option value="120">120 columns</option>
              </Select>
              <Toggle checked={state.singleQuote} onChange={(v) => set('singleQuote', v)}>
                Single quotes
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
        leftLabel={PARSERS.find((p) => p.value === state.parser)?.label ?? 'Input'}
        rightLabel={formatting ? 'Formatted' : 'Minified'}
        left={
          <CodeArea
            value={state.text}
            onChange={(e) => set('text', e.target.value)}
            placeholder="Paste a stylesheet…"
          />
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            {cssOnly && (
              <div className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2 text-[12px] text-muted">
                <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
                <p className="min-w-0">
                  Minify handles plain CSS only. Compile{' '}
                  {state.parser === 'scss' ? 'SCSS' : 'Less'} to CSS first, or{' '}
                  <button
                    type="button"
                    onClick={() => set('parser', 'css')}
                    className="min-h-11 text-fg underline underline-offset-2 md:min-h-0"
                  >
                    switch to CSS
                  </button>{' '}
                  if this is plain CSS.
                </p>
              </div>
            )}
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
