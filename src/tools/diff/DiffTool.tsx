import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Check, ChevronDown, ChevronUp, FileDiff, Link, Upload } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented } from '@/components/ui/Button'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { readTextFile } from '@/lib/util/filedrop'
import { formatBytes, formatCount } from '@/lib/util/bytes'
import { copyText } from '@/lib/util/clipboard'
import { MergePane, type DiffApi } from './MergePane'
import {
  ignoreLabel,
  type IgnoreOptions,
  toUnifiedPatch,
  diffStats,
  MAX_SHARE_CHARS,
  SHARE_PARAM,
  decodeShare,
  encodeShare,
} from '@fadeltd/devtools-core/diff'
import { diffFor } from './engine'
import { prepareView, TRANSFORM_BANNERS, TRANSFORM_LABELS, type Transform } from './view'

interface State {
  left: string
  right: string
  mode: 'split' | 'unified'
  wrapLines: boolean
  // Added after launch. Stored state is merged over INITIAL, so older saves
  // pick up the defaults without a stateVersion bump.
  ignoreWhitespace: boolean
  ignoreCase: boolean
  trim: boolean
  /** A rewrite of both sides before diffing. The input itself is never changed. */
  transform: Transform
}

const INITIAL: State = {
  left: '',
  right: '',
  mode: 'split',
  wrapLines: false,
  ignoreWhitespace: false,
  ignoreCase: false,
  trim: false,
  transform: 'none',
}

const TRANSFORMS: readonly Transform[] = ['none', 'sort-lines', 'json']

function isTransform(v: string): v is Transform {
  return (TRANSFORMS as readonly string[]).includes(v)
}

const PATCH_LABELS: Record<Transform, string> = {
  none: 'Patch',
  'sort-lines': 'Patch (sorted view)',
  json: 'Patch (JSON view)',
}

function ignoreOf(s: State): IgnoreOptions {
  return { whitespace: s.ignoreWhitespace, case: s.ignoreCase, trim: s.trim }
}

/** Past this much raw text, no link could fit under the cap; skip compressing it. */
const MAX_SHARE_SOURCE_CHARS = 1_000_000

/** A ready link, or how big it would have been (null when not worth measuring). */
type ShareLink = { url: string } | { tooLarge: number | null }

const SHARE_PREFIX = `#${SHARE_PARAM}=`

export default function DiffTool() {
  useToolUsageTracker('diff')
  const { state, setState, reset, hydrating } = useToolState<State>('diff', INITIAL)
  const api = useRef<DiffApi | null>(null)
  const onReady = useCallback((next: DiffApi | null) => {
    api.current = next
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [patchCopied, setPatchCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Opened from a share link: load it over whatever was saved. setState marks
  // the state dirty, so the async IDB hydration cannot overwrite it afterwards.
  useEffect(() => {
    const hash = window.location.hash
    if (!hash.startsWith(SHARE_PREFIX)) return
    let cancelled = false
    void decodeShare(hash).then((shared) => {
      if (cancelled) return
      // Drop the fragment so a reload does not reapply it over later edits.
      // history.state is kept: React Router stores its index there.
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      if (shared === null) {
        setError('This share link is damaged or from a newer version.')
        return
      }
      setState((p) => ({ ...p, left: shared.left, right: shared.right }))
      setNotice('Opened a shared diff. It replaced your previous comparison.')
    })
    return () => {
      cancelled = true
    }
  }, [setState])

  const deferred = useDeferredValue(state)

  // Built ahead of the click: compression is async, and Safari refuses a
  // clipboard write that happens after an await.
  const { left: shareLeft, right: shareRight } = deferred
  const isEmpty = shareLeft === '' && shareRight === ''
  const isHuge = shareLeft.length + shareRight.length > MAX_SHARE_SOURCE_CHARS
  const [encoded, setEncoded] = useState<{ left: string; right: string; value: string } | null>(null)
  useEffect(() => {
    if (isEmpty || isHuge) return
    let cancelled = false
    void encodeShare(shareLeft, shareRight).then((value) => {
      if (!cancelled) setEncoded({ left: shareLeft, right: shareRight, value })
    })
    return () => {
      cancelled = true
    }
  }, [shareLeft, shareRight, isEmpty, isHuge])

  // null while empty, or while the current text is still being encoded.
  let share: ShareLink | null = null
  if (isHuge) share = { tooLarge: null }
  else if (!isEmpty && encoded?.left === shareLeft && encoded.right === shareRight) {
    share =
      encoded.value.length > MAX_SHARE_CHARS
        ? { tooLarge: encoded.value.length }
        : { url: window.location.origin + window.location.pathname + SHARE_PREFIX + encoded.value }
  }

  // What the panes show, and whether they may show it at all, decided on the
  // live text: see prepareView. Only the stats below run on a deferred copy.
  const { left, right, transform } = state
  const view = useMemo(() => prepareView(left, right, transform), [left, right, transform])
  const size = view.size
  const transforming = transform !== 'none'

  const deferredView = useDeferredValue(view)
  const stats = useMemo(() => {
    const { left: a, right: b, size: verdict } = deferredView
    if (verdict.tier === 'refuse') return null
    if (a === '' && b === '') return null
    const settings = { ignore: ignoreOf(deferred), refine: verdict.tier === 'ok' }
    return diffStats(a, b, diffFor(a, b, settings).lines)
  }, [deferredView, deferred])

  const ignoring = ignoreLabel(ignoreOf(state))

  // Side-by-side monospace panes are unusable at phone width, so the split
  // toggle is hidden below md and the view is forced to unified there.
  const isNarrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 47.99rem)').matches
  const effectiveMode = isNarrow ? 'unified' : state.mode

  function swap() {
    setState((p) => ({ ...p, left: p.right, right: p.left }))
  }

  function copyPatch() {
    // Built and written inside the click handler: Safari refuses a clipboard
    // write that happens anywhere else.
    // Of what is shown: in a transform, the sorted text, as the label says.
    const patch = toUnifiedPatch(view.left, view.right)
    if (patch === null) {
      setError('These inputs are too different to build a patch in time. Use `diff -u` on the command line.')
      return
    }
    setError(null)
    void copyText(patch).then((ok) => {
      if (!ok) return
      setPatchCopied(true)
      setTimeout(() => setPatchCopied(false), 1200)
    })
  }

  function copyLink() {
    if (share === null) return
    if ('tooLarge' in share) {
      const measured = share.tooLarge === null ? '' : `${formatBytes(share.tooLarge)} encoded, `
      setError(
        `Too large to share as a link (${measured}limit ${formatBytes(MAX_SHARE_CHARS, 0)}). Copy the patch instead.`,
      )
      return
    }
    setError(null)
    void copyText(share.url).then((ok) => {
      if (!ok) return
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1200)
    })
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
            setError(r.reason)
            return
          }
          setError(null)
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
          <Toggle
            checked={state.ignoreWhitespace}
            onChange={(v) => setState((p) => ({ ...p, ignoreWhitespace: v }))}
          >
            Ignore whitespace
          </Toggle>
          <Toggle
            checked={state.ignoreCase}
            onChange={(v) => setState((p) => ({ ...p, ignoreCase: v }))}
          >
            Ignore case
          </Toggle>
          <Toggle checked={state.trim} onChange={(v) => setState((p) => ({ ...p, trim: v }))}>
            Trim
          </Toggle>
          <Select
            value={transform}
            onChange={(e) => {
              const next = e.target.value
              if (isTransform(next)) setState((p) => ({ ...p, transform: next }))
            }}
            aria-label="Compare as"
            title="Rewrite both sides before comparing. Your text is kept as written; the view is read-only meanwhile."
          >
            {TRANSFORMS.map((t) => (
              <option key={t} value={t}>
                {TRANSFORM_LABELS[t]}
              </option>
            ))}
          </Select>

          {stats !== null && (
            <span className="flex items-center gap-1.5 font-mono text-[12px]">
              {stats.identical ? (
                <Badge>{ignoring === null ? 'identical' : `identical (ignoring ${ignoring})`}</Badge>
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
          <Button
            onClick={copyPatch}
            disabled={view.left === view.right || size.tier === 'refuse'}
            title={
              transforming
                ? 'Copy the shown, rewritten text as a unified patch, not your original text. The Ignore toggles do not apply.'
                : 'Copy as a unified patch. Always exact: the Ignore toggles do not apply.'
            }
          >
            {patchCopied ? (
              <Check size={14} className="text-add" aria-hidden />
            ) : (
              <FileDiff size={14} aria-hidden />
            )}
            {patchCopied ? 'Copied' : PATCH_LABELS[transform]}
          </Button>
          <Button
            onClick={copyLink}
            disabled={share === null}
            title="Copy a link containing both sides. Nothing is uploaded, but anyone with the link can read it."
          >
            {linkCopied ? (
              <Check size={14} className="text-add" aria-hidden />
            ) : (
              <Link size={14} aria-hidden />
            )}
            {linkCopied ? 'Copied' : 'Link'}
          </Button>
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {error !== null && (
          <div className="shrink-0 border-b border-border px-3 py-1.5 text-[12px] text-del">
            {error}
          </div>
        )}
        {notice !== null && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-1.5 text-[12px] text-muted">
            {notice}
            <Button variant="ghost" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          </div>
        )}
        {transforming && (
          // Not dismissible: while it is up, the panes are not your text.
          <div className="shrink-0 border-b border-border px-3 py-1.5 text-[12px]">
            <div className="flex items-center justify-between gap-3 text-muted">
              <span>{TRANSFORM_BANNERS[transform]} Both sides are read-only; your text is unchanged.</span>
              <Button onClick={() => setState((p) => ({ ...p, transform: 'none' }))}>Show original</Button>
            </div>
            {view.problems.map((problem) => (
              <div key={problem} className="text-del">
                {problem}
              </div>
            ))}
            {view.notes.map((note) => (
              <div key={note} className="text-warn">
                {note}
              </div>
            ))}
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
              left={view.left}
              right={view.right}
              mode={effectiveMode}
              wrapLines={state.wrapLines}
              highlightChanges={size.tier === 'ok'}
              ignore={ignoreOf(state)}
              readOnly={transforming}
              onChangeLeft={(value) => setState((p) => ({ ...p, left: value }))}
              onChangeRight={(value) => setState((p) => ({ ...p, right: value }))}
              onRejectEdit={setError}
            />
          </div>
        )}
      </div>
    </ToolFrame>
  )
}
