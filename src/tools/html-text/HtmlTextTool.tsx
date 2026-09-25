import { useDeferredValue, useMemo } from 'react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatBytes } from '@/lib/util/bytes'
import { htmlToText } from './core/extract'

interface State {
  html: string
  linkUrls: boolean
  skipHiddenClasses: boolean
}

const INITIAL: State = { html: '', linkUrls: false, skipHiddenClasses: false }

export default function HtmlTextTool() {
  useToolUsageTracker('html-text')
  const { state, setState, reset } = useToolState<State>('html-text', INITIAL)

  const deferred = useDeferredValue(state)
  const { output, sizeNote } = useMemo(() => {
    if (deferred.html === '') return { output: '', sizeNote: null }
    const text = htmlToText(deferred.html, {
      linkUrls: deferred.linkUrls,
      skipHiddenClasses: deferred.skipHiddenClasses,
    })
    const enc = new TextEncoder()
    return {
      output: text,
      sizeNote: `${formatBytes(enc.encode(deferred.html).length)} → ${formatBytes(enc.encode(text).length)}`,
    }
  }, [deferred])

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'HTML to Text',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
  ])

  return (
    <ToolFrame
      slug="html-text"
      actions={
        <>
          <Toggle
            checked={state.linkUrls}
            onChange={(v) => setState((p) => ({ ...p, linkUrls: v }))}
          >
            Show link URLs
          </Toggle>
          <Toggle
            checked={state.skipHiddenClasses}
            onChange={(v) => setState((p) => ({ ...p, skipHiddenClasses: v }))}
          >
            Skip .hidden / .sr-only
          </Toggle>
          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel="HTML"
        rightLabel="Text"
        left={
          <CodeArea
            value={state.html}
            onChange={(e) => setState((p) => ({ ...p, html: e.target.value }))}
            placeholder="Paste HTML — a page source, an email, or a copied element…"
          />
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            <CodeArea value={output} readOnly placeholder="Text appears here" />
            {sizeNote !== null && (
              <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
                <span>{sizeNote}</span>
              </div>
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
