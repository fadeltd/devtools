import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { diff } from '@codemirror/merge'
import { ArrowLeftRight, ChevronDown, ChevronUp, Upload } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { readTextFile } from '@/lib/util/filedrop'
import { formatCount } from '@/lib/util/bytes'
import { MergePane, type DiffApi } from './MergePane'
import { assessSize, diffStats } from './core/stats'

interface State {
  left: string
  right: string
  mode: 'split' | 'unified'
  wrapLines: boolean
}

const INITIAL: State = { left: '', right: '', mode: 'split', wrapLines: false }

export default function DiffTool() {
  useToolUsageTracker('diff')
  const { state, setState, reset, hydrating } = useToolState<State>('diff', INITIAL)
  const api = useRef<DiffApi | null>(null)
  const onReady = useCallback((next: DiffApi | null) => {
    api.current = next
  }, [])
  const [dropError, setDropError] = useState<string | null>(null)

  const deferred = useDeferredValue(state)
  const size = useMemo(() => assessSize(deferred.left, deferred.right), [deferred])

  const stats = useMemo(() => {
    if (size.tier === 'refuse') return null
    if (deferred.left === '' && deferred.right === '') return null
    return diffStats(deferred.left, deferred.right, diff(deferred.left, deferred.right))
  }, [deferred, size.tier])

  // Side-by-side monospace panes are unusable at phone width, so the split
  // toggle is hidden below md and the view is forced to unified there.
  const isNarrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 47.99rem)').matches
  const effectiveMode = isNarrow ? 'unified' : state.mode

  function swap() {
    setState((p) => ({ ...p, left: p.right, right: p.left }))
  }

  async function pick(side: 'left' | 'right') {
    const input = document.createElement('input')
    input.type = 'file'
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0]
        if (!file) return
        void readTextFile(file).then((r) => {
          if (!r.ok) {
            setDropError(r.reason)
            return
          }
          setDropError(null)
          setState((p) => ({ ...p, [side]: r.file.text }))
        })
      },
      { once: true },
    )
    // There is no drag-and-drop on iOS, so a picker is the primary path.
    input.click()
  }

  useShortcuts([
    {
      combo: 'alt+arrowdown',
      label: 'Next change',
      group: 'Diff',
      scope: 'tool',
      whileTyping: true,
      run: () => api.current?.jump('next'),
    },
    {
      combo: 'alt+arrowup',
      label: 'Previous change',
      group: 'Diff',
      scope: 'tool',
      whileTyping: true,
      run: () => api.current?.jump('prev'),
    },
    {
      combo: 'mod+shift+s',
      label: 'Swap sides',
      group: 'Diff',
      scope: 'tool',
      whileTyping: true,
      run: swap,
    },
  ])

  return (
    <ToolFrame
      slug="diff"
      actions={
        <>
          {/* Hidden below md, where the view is forced to unified anyway. */}
          <div className="hidden md:block">
            <Segmented
              value={state.mode}
              onChange={(mode) => setState((p) => ({ ...p, mode }))}
              options={[
                { value: 'split', label: 'Side by side' },
                { value: 'unified', label: 'Unified' },
              ]}
            />
          </div>

          <Toggle
            checked={state.wrapLines}
            onChange={(v) => setState((p) => ({ ...p, wrapLines: v }))}
          >
            Wrap
          </Toggle>

          {stats !== null && (
            <span className="flex items-center gap-1.5 font-mono text-[12px]">
              {stats.identical ? (
                <Badge>identical</Badge>
              ) : (
                <>
                  {stats.addedLines > 0 && <span className="text-add">+{stats.addedLines}</span>}
                  {stats.removedLines > 0 && (
                    <span className="text-del">&minus;{stats.removedLines}</span>
                  )}
                  {stats.changedLines > 0 && (
                    <span className="text-warn">~{stats.changedLines}</span>
                  )}
                  <span className="text-faint">
                    {formatCount(stats.chunks)} {stats.chunks === 1 ? 'change' : 'changes'}
                  </span>
                </>
              )}
            </span>
          )}

          <Button onClick={() => api.current?.jump('prev')} title="Previous change (Alt+Up)">
            <ChevronUp size={14} aria-hidden />
          </Button>
          <Button onClick={() => api.current?.jump('next')} title="Next change (Alt+Down)">
            <ChevronDown size={14} aria-hidden />
          </Button>

          <Button onClick={() => void pick('left')} title="Load a file into the left side">
            <Upload size={14} aria-hidden />
            Left
          </Button>
          <Button onClick={() => void pick('right')} title="Load a file into the right side">
            <Upload size={14} aria-hidden />
            Right
          </Button>

          <Button onClick={swap} title="Swap sides (Cmd+Shift+S)">
            <ArrowLeftRight size={14} aria-hidden />
          </Button>
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {dropError !== null && (
          <div className="shrink-0 border-b border-border px-3 py-1.5 text-[12px] text-del">
            {dropError}
          </div>
        )}
        {size.reason !== null && (
          <div className="shrink-0 border-b border-border px-3 py-1.5 text-[12px] text-warn">
            {size.reason}
          </div>
        )}

        {size.tier === 'refuse' ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-muted">
            Input too large to display.
          </div>
        ) : hydrating ? (
          <div className="p-3 font-mono text-[13px] text-faint">Restoring your last diff…</div>
        ) : (
          <div className="min-h-0 flex-1">
            <MergePane
              onReady={onReady}
              left={state.left}
              right={state.right}
              mode={effectiveMode}
              wrapLines={state.wrapLines}
              highlightChanges={size.tier === 'ok'}
              onChangeLeft={(value) => setState((p) => ({ ...p, left: value }))}
              onChangeRight={(value) => setState((p) => ({ ...p, right: value }))}
            />
          </div>
        )}
      </div>
    </ToolFrame>
  )
}
