import type { Remote } from 'comlink'
import { useDeferredValue, type ReactNode } from 'react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton, RichCopyButton } from '@/components/ui/CopyButton'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyRich } from '@/lib/util/clipboard'
import { useWorkerJob } from '@/lib/worker/useWorkerJob'
import { MarkdownPreview } from './MarkdownPreview'
import type { MarkdownApi, MarkdownRender } from './markdown.worker'

interface State {
  text: string
}

const INITIAL: State = { text: '' }

const PLACEHOLDER = `Write or paste Markdown…

| Service | Status |
|:--------|-------:|
| api     |     ok |
| worker  |   slow |

Copy formatted, then paste into Slack: it stays a table.`

/** A finished render, tagged with the source it was made from. */
interface Outcome {
  source: string
  render: MarkdownRender
}

// Module-level so useWorkerJob sees stable references.
function spawnMarkdown() {
  return new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' })
}

async function runInWorker(api: Remote<MarkdownApi>, source: string): Promise<Outcome> {
  return { source, render: await api.render(source) }
}

export default function MarkdownTool() {
  useToolUsageTracker('markdown')
  const { state, setState, reset, hydrating } = useToolState<State>('markdown', INITIAL)

  // Keeps typing responsive: the worker runs against a deferred snapshot.
  const source = useDeferredValue(state.text)
  const job = useWorkerJob(spawnMarkdown, runInWorker, source)
  const outcome = state.text === '' ? undefined : job.result

  // The copy is the last finished render and the source it came from, so the
  // two halves on the clipboard always agree. That is a keystroke behind while
  // typing; once a render is stuck or cancelled it is stale, and copying it
  // would hand over something other than what is on screen in the editor.
  const stale = outcome !== undefined && outcome.source !== state.text && job.status !== 'running'
  const html = outcome === undefined || stale ? '' : outcome.render.html
  const copySource = outcome?.source ?? ''

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy formatted',
      group: 'Markdown Preview',
      scope: 'tool',
      whileTyping: true,
      run: () => {
        if (html !== '') void copyRich(html, copySource)
      },
    },
  ])

  let body: ReactNode
  if (state.text === '') {
    body = (
      <p className="p-3 text-[12px] text-faint">
        {hydrating ? 'Restoring your last input…' : 'The rendered document appears here.'}
      </p>
    )
  } else if (outcome === undefined) {
    body = <p className="p-3 text-[12px] text-faint">Rendering…</p>
  } else {
    body = (
      <div className="min-h-0 flex-1 overflow-auto p-4 scroll-thin">
        <MarkdownPreview doc={outcome.render.doc} />
      </div>
    )
  }

  const notices: ReactNode[] = []
  if (outcome?.render.truncated === true) {
    notices.push(
      <span key="cut" className="flex items-center gap-2">
        <Badge tone="warn">Preview shortened</Badge>
        <span>This shows the start of a long document. Copy formatted still copies all of it.</span>
      </span>,
    )
  }
  if (job.status === 'slow') {
    notices.push(
      <span key="slow" className="flex items-center gap-2">
        <Badge tone="warn">Still rendering after 2s</Badge>
        <Button variant="danger" onClick={job.cancel}>
          Cancel
        </Button>
      </span>,
    )
  } else if (job.status === 'cancelled') {
    notices.push(
      <Badge key="cancelled" tone="del" title="Edit the Markdown to render again">
        Cancelled — showing the last finished render
      </Badge>,
    )
  } else if (job.status === 'error') {
    notices.push(
      <Badge key="error" tone="del">
        {job.error}
      </Badge>,
    )
  }

  return (
    <ToolFrame
      slug="markdown"
      actions={
        <>
          <RichCopyButton
            html={html}
            text={copySource}
            title={stale ? 'The preview is out of date, so there is nothing current to copy' : undefined}
          />
          <CopyButton value={state.text} label="Copy Markdown" />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel="Markdown"
        rightLabel="Preview"
        left={
          <CodeArea
            value={state.text}
            onChange={(e) => setState({ text: e.target.value })}
            placeholder={PLACEHOLDER}
            aria-label="Markdown"
          />
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            {notices.length > 0 && state.text !== '' && (
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[11px] text-muted">
                {notices}
              </div>
            )}
            {body}
          </div>
        }
      />
    </ToolFrame>
  )
}
