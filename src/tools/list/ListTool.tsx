import type { Remote } from 'comlink'
import { Check, Link } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
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
import { cn } from '@/lib/util/cn'
import { formatBytes, formatCount } from '@/lib/util/bytes'
import { countStats } from '@fadeltd/devtools-core/text'
import { useWorkerJob, type JobStatus } from '@/lib/worker/useWorkerJob'
import {
  parseLines,
  decodePipeline,
  defaultOp,
  encodePipeline,
  isOpKind,
  MAX_PIPELINE_CHARS,
  PIPELINE_PARAM,
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

const PIPELINE_PREFIX = `#${PIPELINE_PARAM}=`

/** A ready link, or why there is none. `pending` while the current steps encode. */
type ShareLink =
  | { url: string }
  | { problem: 'empty' | 'invalid' | 'pending' }
  | { problem: 'tooLarge'; chars: number }

/** Always visible, not just a tooltip: there is no hover on a phone. */
function shareHint(share: ShareLink, carriesList: boolean): string {
  // Pending lasts a few ms per edit; flashing a different message is noise.
  if ('url' in share || share.problem === 'pending') {
    return carriesList
      ? 'The link carries your steps, including the compare list — never your input.'
      : 'The link carries your steps — never your input.'
  }
  switch (share.problem) {
    case 'empty':
      return 'Add a step to share the pipeline.'
    case 'invalid':
      return 'A setting is too large to put in a link.'
    case 'tooLarge':
      return `Too long for a link (${formatBytes(share.chars)} encoded, limit ${formatBytes(MAX_PIPELINE_CHARS, 0)}).`
  }
}

type Notice = { tone: 'info' | 'error'; text: string }

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
  const [notice, setNotice] = useState<Notice | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)

  const routeSegment = location.pathname.split('/')[2] ?? ''
  const routeKind = isOpKind(routeSegment) ? routeSegment : undefined

  // Opened from a pipeline link: replace the steps, never the input text.
  // List state lives in localStorage and is read synchronously on the first
  // render, so it is already in place before this resolves and cannot land on
  // top of it; and setState marks the state dirty, so even an async (idb)
  // hydration would leave the loaded steps alone -- as in Diff.
  useEffect(() => {
    let cancelled = false
    function load() {
      const hash = window.location.hash
      if (!hash.startsWith(PIPELINE_PREFIX)) return
      void decodePipeline(hash).then((shared) => {
        // A newer link may have arrived meanwhile; only the latest one counts.
        if (cancelled || window.location.hash !== hash) return
        if (shared === null) {
          // The fragment stays, so the broken link can still be copied and reported.
          setNotice({ tone: 'error', text: 'That pipeline link is damaged or from a newer version.' })
          return
        }
        setState((p) => ({ ...p, steps: shared.map((s) => ({ ...s, id: crypto.randomUUID() })) }))
        const n = shared.length
        setNotice({
          tone: 'info',
          text: `Loaded a shared pipeline (${n} ${n === 1 ? 'step' : 'steps'}). It replaced your previous steps; your input is unchanged.`,
        })
        // Drop the fragment so a reload does not reapply it over later edits.
        // On /list/<kind> a single loaded step would be swapped for that kind,
        // so leave the deep link too; navigate() drops the fragment by itself.
        if (routeKind !== undefined) void navigate('/list', { replace: true })
        // history.state is kept: React Router stores its index there.
        else window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      })
    }
    load()
    // A link pasted into the address bar of an open List tab is a same-page
    // fragment change, not a load.
    window.addEventListener('hashchange', load)
    return () => {
      cancelled = true
      window.removeEventListener('hashchange', load)
    }
  }, [setState, navigate, routeKind])

  // Memoised: a fresh array here would re-key the worker input on every render,
  // and every result would then trigger another run.
  const steps = useMemo(() => withRouteKind(state.steps, routeKind), [state.steps, routeKind])

  function setSteps(next: Step[]) {
    setState((p) => ({ ...p, steps: next }))
    // Editing makes the pipeline yours; the deep link has done its job.
    if (routeKind !== undefined) void navigate('/list', { replace: true })
  }

  const ops = useMemo(() => steps.filter((s) => s.enabled).map((s) => s.op), [steps])

  // Built ahead of the click: compression is async, and Safari refuses a
  // clipboard write that happens after an await.
  const shareSteps = useDeferredValue(steps)
  const [encoded, setEncoded] = useState<{ steps: readonly Step[]; value: string | null } | null>(null)
  useEffect(() => {
    if (shareSteps.length === 0) return
    let cancelled = false
    void encodePipeline(shareSteps).then((value) => {
      if (!cancelled) setEncoded({ steps: shareSteps, value })
    })
    return () => {
      cancelled = true
    }
  }, [shareSteps])

  let share: ShareLink
  if (steps.length === 0) share = { problem: 'empty' }
  else if (encoded?.steps !== steps) share = { problem: 'pending' }
  else if (encoded.value === null) share = { problem: 'invalid' }
  else if (encoded.value.length > MAX_PIPELINE_CHARS) share = { problem: 'tooLarge', chars: encoded.value.length }
  // Always /list: on /list/<kind> a one-step link would be swapped for that kind.
  else share = { url: `${window.location.origin}/list${PIPELINE_PREFIX}${encoded.value}` }
  const carriesList = steps.some((s) => s.op.kind === 'setop' && s.op.other !== '')

  function copyLink() {
    if (!('url' in share)) return
    // Called straight from the click: Safari refuses a later clipboard write.
    void copyText(share.url).then((ok) => {
      if (!ok) return
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1200)
    })
  }
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
      <div className="flex h-full min-h-0 flex-col">
        {notice !== null && (
          <div
            role="status"
            className={cn(
              'flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-1.5 text-[12px]',
              notice.tone === 'error' ? 'text-del' : 'text-muted',
            )}
          >
            {notice.text}
            <Button variant="ghost" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          </div>
        )}
        <div className="min-h-0 flex-1">
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
                <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5">
                  <Button
                    onClick={copyLink}
                    disabled={!('url' in share)}
                    aria-describedby="list-share-hint"
                    title="Copy a link to this pipeline. Nothing is uploaded, but anyone with the link can read the steps."
                  >
                    {linkCopied ? <Check size={14} className="text-add" aria-hidden /> : <Link size={14} aria-hidden />}
                    {linkCopied ? 'Copied' : 'Copy link'}
                  </Button>
                  <span id="list-share-hint" className="min-w-0 text-[11px] text-faint">
                    {shareHint(share, carriesList)}
                  </span>
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
        </div>
      </div>
    </ToolFrame>
  )
}
