import { useEffect, useRef } from 'react'
import { Annotation, ChangeSet, EditorState, type Extension, type Transaction } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import {
  MergeView,
  getOriginalDoc,
  goToNextChunk,
  goToPreviousChunk,
  originalDocChangeEffect,
  unifiedMergeView,
} from '@codemirror/merge'
import { diffTheme } from './theme'
import { MAX_DIFF_CHARS, MAX_DIFF_LINE_CHARS, type IgnoreOptions } from '@fadeltd/devtools-core/diff'
import { makeDiffConfig } from './engine'

export interface DiffApi {
  jump: (direction: 'next' | 'prev') => void
  focus: (side: 'left' | 'right') => void
}

export interface MergePaneProps {
  left: string
  right: string
  mode: 'split' | 'unified'
  wrapLines: boolean
  /** Turn off intra-line highlighting on very large inputs. */
  highlightChanges: boolean
  /** What counts as equal. Changing it rebuilds the view (see below). */
  ignore: IgnoreOptions
  /** Shows the text without accepting edits, e.g. a sorted view of the input. */
  readOnly: boolean
  onChangeLeft: (value: string) => void
  onChangeRight: (value: string) => void
  /** An edit was refused because the result would be too large to display. */
  onRejectEdit: (reason: string) => void
  /** Called with a handle for chunk navigation on mount, and null on unmount. */
  onReady?: (api: DiffApi | null) => void
}

const chunkKeymap = keymap.of([
  { key: 'Alt-ArrowDown', run: (v) => goToNextChunk(v), preventDefault: true },
  { key: 'Alt-ArrowUp', run: (v) => goToPreviousChunk(v), preventDefault: true },
  { key: 'F8', run: (v) => goToNextChunk(v), preventDefault: true },
  { key: 'Shift-F8', run: (v) => goToPreviousChunk(v), preventDefault: true },
])

/** Marks text pushed in from React, which must not be echoed back as an edit. */
const external = Annotation.define<true>()

/**
 * Why an edit would push this side past what the diff tool will display, or
 * null if it is fine. Only the lines the edit touched are measured, so typing
 * stays O(edit) rather than O(document).
 */
function oversize(tr: Transaction): string | null {
  const doc = tr.newDoc
  if (doc.length > MAX_DIFF_CHARS) {
    return 'That edit was not applied: each side must stay under 8 MB.'
  }
  let longest = 0
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    for (let pos = fromB; ; ) {
      const line = doc.lineAt(pos)
      if (line.length > longest) longest = line.length
      if (line.to >= toB) break
      pos = line.to + 1
    }
  }, true)
  if (longest <= MAX_DIFF_LINE_CHARS) return null
  return `That edit was not applied: it would make one line ${longest.toLocaleString('en-US')} characters long, over the ${MAX_DIFF_LINE_CHARS.toLocaleString('en-US')} that can be displayed.`
}

function baseExtensions(
  wrapLines: boolean,
  readOnly: boolean,
  onReject: (reason: string) => void,
): Extension[] {
  const ext: Extension[] = [
    lineNumbers(),
    diffTheme,
    chunkKeymap,
    // Still editable (focusable, selectable, navigable by chunk) when read-only;
    // readOnly is what blocks input.
    EditorView.editable.of(true),
    EditorState.readOnly.of(readOnly),
    // DiffTool refuses oversize text before it reaches the view, but a paste
    // lands here first. Without this, CodeMirror would lay out a 5 MB line on
    // the main thread before the refusal could unmount it.
    EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged || tr.annotation(external)) return tr
      const reason = oversize(tr)
      if (reason === null) return tr
      onReject(reason)
      return []
    }),
  ]
  if (wrapLines) ext.push(EditorView.lineWrapping)
  return ext
}

/** Calls `onChange` for the user's edits only, not for text pushed in from React. */
function changeListener(onChange: (value: string) => void): Extension {
  return EditorView.updateListener.of((u) => {
    if (!u.docChanged || u.transactions.some((tr) => tr.annotation(external))) return
    onChange(u.state.doc.toString())
  })
}

/**
 * Imperative wrapper around CodeMirror's MergeView.
 *
 * The view owns the document while mounted, so React only pushes text in when
 * it changes from the outside (a file drop, a swap, restored state) and reads
 * it back out through the change callbacks. Rebuilding the view on every
 * keystroke would lose the cursor and the scroll position.
 */
export function MergePane(props: MergePaneProps) {
  const { mode, wrapLines, highlightChanges, readOnly, left, right, onReady } = props
  // Primitives, so a fresh `ignore` object each render does not rebuild the view.
  const { whitespace, case: ignoreCase, trim } = props.ignore
  const host = useRef<HTMLDivElement>(null)
  const mergeRef = useRef<MergeView | null>(null)
  const unifiedRef = useRef<EditorView | null>(null)
  // The text each side last held, whether pushed in or typed. Compared by
  // reference instead of `doc.toString()`, which would build two copies of a
  // multi-MB document on every keystroke, and which never equals CRLF input
  // (CodeMirror normalises line breaks), so the other pane would be replaced
  // on each edit.
  const seen = useRef({ left: '', right: '' })

  // Callbacks and latest values via a ref, so the view is not rebuilt on every
  // render -- only when the structural options below actually change. Assigned
  // in an effect (declared first, so it runs before the ones that read it).
  const cb = useRef(props)
  useEffect(() => {
    cb.current = props
  })

  useEffect(() => {
    const parent = host.current
    if (!parent) return

    const collapseUnchanged = { margin: 3, minSize: 4 }
    // MergeView.reconfigure({ diffConfig }) swaps the config but does not
    // recompute chunks until the next edit, so option changes rebuild the
    // view instead -- the same as mode and wrapping already do.
    const diffConfig = makeDiffConfig({
      ignore: { whitespace, case: ignoreCase, trim },
      refine: highlightChanges,
    })
    const base = baseExtensions(wrapLines, readOnly, (reason) => cb.current.onRejectEdit(reason))
    seen.current = { left: cb.current.left, right: cb.current.right }
    const onLeft = (value: string) => {
      seen.current.left = value
      cb.current.onChangeLeft(value)
    }
    const onRight = (value: string) => {
      seen.current.right = value
      cb.current.onChangeRight(value)
    }

    if (mode === 'split') {
      const view = new MergeView({
        parent,
        orientation: 'a-b',
        highlightChanges,
        gutter: true,
        collapseUnchanged,
        diffConfig,
        // Deliberately no revertControls: you merge in git, not in a browser tab.
        a: {
          doc: cb.current.left,
          extensions: [...base, changeListener(onLeft)],
        },
        b: {
          doc: cb.current.right,
          extensions: [...base, changeListener(onRight)],
        },
      })
      mergeRef.current = view
      return () => {
        view.destroy()
        mergeRef.current = null
      }
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: cb.current.right,
        extensions: [
          unifiedMergeView({
            original: cb.current.left,
            highlightChanges,
            gutter: true,
            collapseUnchanged,
            diffConfig,
            mergeControls: false,
          }),
          ...base,
          changeListener(onRight),
        ],
      }),
    })
    unifiedRef.current = view
    return () => {
      view.destroy()
      unifiedRef.current = null
    }
    // readOnly rebuilds too: it flips only when a transform swaps in different
    // text, which replaces the whole document anyway.
  }, [mode, wrapLines, highlightChanges, readOnly, whitespace, ignoreCase, trim])

  // Push external text changes in without clobbering an in-progress edit.
  // Annotated, so the change listener does not write the text back to state:
  // in a transform it is the transformed text, and would overwrite the input.
  useEffect(() => {
    const merge = mergeRef.current
    const unified = unifiedRef.current
    const replace = (view: EditorView, text: string) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: external.of(true) })
    }

    if (left !== seen.current.left) {
      seen.current.left = left
      if (merge) replace(merge.a, left)
      else if (unified) {
        // The unified view keeps the left side as its "original" document,
        // outside the editable doc, so it has its own update path.
        const original = getOriginalDoc(unified.state)
        const changes = ChangeSet.of({ from: 0, to: original.length, insert: left }, original.length)
        unified.dispatch({ effects: originalDocChangeEffect(unified.state, changes), annotations: external.of(true) })
      }
    }
    if (right !== seen.current.right) {
      seen.current.right = right
      const view = merge?.b ?? unified
      if (view) replace(view, right)
    }
  }, [left, right])

  useEffect(() => {
    if (!onReady) return
    onReady({
      jump: (direction) => {
        const view = mergeRef.current?.b ?? unifiedRef.current
        if (!view) return
        const command = direction === 'next' ? goToNextChunk : goToPreviousChunk
        command(view)
        view.focus()
      },
      focus: (side) => {
        const merge = mergeRef.current
        const view = merge ? (side === 'left' ? merge.a : merge.b) : unifiedRef.current
        view?.focus()
      },
    })
    return () => onReady(null)
    // No `mode` dependency: jump and focus read the refs when called, so one
    // handle serves both the split and the unified view.
  }, [onReady])

  return <div ref={host} className="h-full min-h-0 *:h-full scroll-thin" />
}
