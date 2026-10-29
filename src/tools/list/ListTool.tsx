import type { Remote } from 'comlink'
import { useDeferredValue, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import { countStats } from '@fadeltd/devtools-core/text'
import { useWorkerJob, type JobStatus } from '@/lib/worker/useWorkerJob'
import {
  parseLines,
  defaultOp,
  isOpKind,
  withRouteKind,
  type Step,
  type Op,
  type StepStat,
} from '@fadeltd/devtools-core/list'
import { Pipeline } from './Pipeline'
import type { PipelineApi, PipelineOutput } from './pipeline.worker'

interface State {
  text: string
  steps: Step[]
  shuffleNonce: number
}

const INITIAL: State = {
  text: '',
  steps: [{ id: 'initial', op: defaultOp('sort'), enabled: true }],
  shuffleNonce: 0,
}

interface Input {
  text: string
  ops: Op[]
  /** Only here to change the input's identity, so "Shuffle again" re-runs. */
  nonce: number
}

// Module-level so useWorkerJob sees stable references.
function spawnPipeline() {
  return new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' })
}

function runInWorker(api: Remote<PipelineApi>, input: Input): Promise<PipelineOutput> {
  return api.run(input.text, input.ops)
}

function RunStatus({
  status,
  error,
  onCancel,
}: {
  status: JobStatus
  error: string | undefined
  onCancel: () => void
}) {
  switch (status) {
    case 'slow':
      return (
        <>
          <Badge tone="warn" title="Probably a regex that backtracks badly">
            Still running after 2s
          </Badge>
          <Button variant="danger" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )
    case 'cancelled':
      return (
        <Badge tone="del" title="Edit a step or the input to run again">
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

export default function ListTool() {
  useToolUsageTracker('list')
  const navigate = useNavigate()
  const location = useLocation()

  const { state, setState } = useToolState<State>('list', INITIAL)

  const routeSegment = location.pathname.split('/')[2] ?? ''
  const routeKind = isOpKind(routeSegment) ? routeSegment : undefined
  // Memoised: a fresh array here would re-key the worker input on every render,
  // and every result would then trigger another run.
  const steps = useMemo(() => withRouteKind(state.steps, routeKind), [state.steps, routeKind])

  function setSteps(next: Step[]) {
    setState((p) => ({ ...p, steps: next }))
    // Editing makes the pipeline yours; the deep link has done its job.
    if (routeKind !== undefined) void navigate('/list', { replace: true })
  }

  const ops = useMemo(() => steps.filter((s) => s.enabled).map((s) => s.op), [steps])
  // Keeps typing responsive: the worker runs against a deferred snapshot.
  const deferredText = useDeferredValue(state.text)
  const input = useMemo<Input>(
    () => ({ text: deferredText, ops, nonce: state.shuffleNonce }),
    [deferredText, ops, state.shuffleNonce],
  )

  const job = useWorkerJob(spawnPipeline, runInWorker, input)
  const result = job.result
  const output = result?.output ?? ''

  // Map the enabled-only stats back onto every step. Counts from a run with a
  // different shape would point at the wrong cards, so drop them.
  const stats = useMemo(() => {
    const ran = result?.steps
    if (ran?.length !== ops.length) return steps.map(() => undefined)
    let k = 0
    return steps.map((s): StepStat | undefined => (s.enabled ? ran[k++] : undefined))
  }, [result, ops.length, steps])

  const counts = useMemo(() => countStats(output), [output])
  const inputDoc = useMemo(() => parseLines(state.text), [state.text])
  const inputLines = inputDoc.lines.length
  const outputLines = result?.steps.at(-1)?.outLines ?? inputLines

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
      run: () => setState((p) => ({ ...p, text: '' })),
    },
  ])

  return (
    <ToolFrame
      slug="list"
      actions={
        <>
          <CopyButton value={output} />
          <Button
            variant="ghost"
            onClick={() => setState((p) => ({ ...p, text: '' }))}
            title="Clear input (keeps your steps)"
          >
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
              <span>{formatCount(inputLines)} lines in</span>
              {inputDoc.eol === 'mixed' && (
                <Badge tone="warn" title="Output will use LF">
                  mixed line endings
                </Badge>
              )}
              {inputDoc.bom && <Badge tone="warn">BOM</Badge>}
            </div>
          </div>
        }
        middle={
          <div className="flex w-full flex-col bg-surface">
            <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
              <Pipeline
                steps={steps}
                stats={stats}
                stale={job.status !== 'done'}
                onChange={setSteps}
                onReshuffle={() => setState((p) => ({ ...p, shuffleNonce: p.shuffleNonce + 1 }))}
              />
            </div>
            {/* On a phone the output footer is on another tab; Cancel must be
                reachable from where the regex is being typed. */}
            {(job.status === 'slow' || job.status === 'cancelled' || job.status === 'error') && (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-1.5 font-mono text-[11px] md:hidden">
                <RunStatus status={job.status} error={job.error} onCancel={job.cancel} />
              </div>
            )}
          </div>
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            <CodeArea value={output} readOnly placeholder="Output appears here" />
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
              <span>
                {formatCount(inputLines)} → {formatCount(outputLines)} lines
              </span>
              <span>{formatCount(counts.words)} words</span>
              <span>{formatCount(counts.graphemes)} chars</span>
              <span>{formatCount(counts.bytes)} bytes</span>
              {result !== undefined && result.collisions > 0 && (
                <Badge tone="warn" title="These look identical but are encoded differently">
                  {result.collisions} differ only by Unicode form
                </Badge>
              )}
              <RunStatus status={job.status} error={job.error} onCancel={job.cancel} />
            </div>
          </div>
        }
      />
    </ToolFrame>
  )
}
