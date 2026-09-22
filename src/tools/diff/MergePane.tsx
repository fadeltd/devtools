import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { diffTheme } from './theme'

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
  onChangeLeft: (value: string) => void
  onChangeRight: (value: string) => void
  /** Called with a handle for chunk navigation on mount, and null on unmount. */
  onReady?: (api: DiffApi | null) => void
}

const chunkKeymap = keymap.of([
  { key: 'Alt-ArrowDown', run: (v) => goToNextChunk(v), preventDefault: true },
  { key: 'Alt-ArrowUp', run: (v) => goToPreviousChunk(v), preventDefault: true },
  { key: 'F8', run: (v) => goToNextChunk(v), preventDefault: true },
  { key: 'Shift-F8', run: (v) => goToPreviousChunk(v), preventDefault: true },
])

function baseExtensions(wrapLines: boolean): Extension[] {
  const ext: Extension[] = [lineNumbers(), diffTheme, chunkKeymap, EditorView.editable.of(true)]
  if (wrapLines) ext.push(EditorView.lineWrapping)
  return ext
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
  const { mode, wrapLines, highlightChanges, left, right, onReady } = props
  const host = useRef<HTMLDivElement>(null)
  const mergeRef = useRef<MergeView | null>(null)
  const unifiedRef = useRef<EditorView | null>(null)

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

    if (mode === 'split') {
      const view = new MergeView({
        parent,
        orientation: 'a-b',
        highlightChanges,
        gutter: true,
        collapseUnchanged,
        // Deliberately no revertControls: you merge in git, not in a browser tab.
        a: {
          doc: cb.current.left,
          extensions: [
            ...baseExtensions(wrapLines),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) cb.current.onChangeLeft(u.state.doc.toString())
            }),
          ],
        },
        b: {
          doc: cb.current.right,
          extensions: [
            ...baseExtensions(wrapLines),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) cb.current.onChangeRight(u.state.doc.toString())
            }),
          ],
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
            mergeControls: false,
          }),
          ...baseExtensions(wrapLines),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChangeRight(u.state.doc.toString())
          }),
        ],
      }),
    })
    unifiedRef.current = view
    return () => {
      view.destroy()
      unifiedRef.current = null
    }
  }, [mode, wrapLines, highlightChanges])

  // Push external text changes in without clobbering an in-progress edit.
  useEffect(() => {
    const merge = mergeRef.current
    if (merge) {
      if (merge.a.state.doc.toString() !== left) {
        merge.a.dispatch({ changes: { from: 0, to: merge.a.state.doc.length, insert: left } })
      }
      if (merge.b.state.doc.toString() !== right) {
        merge.b.dispatch({ changes: { from: 0, to: merge.b.state.doc.length, insert: right } })
      }
      return
    }

    const unified = unifiedRef.current
    if (unified && unified.state.doc.toString() !== right) {
      unified.dispatch({ changes: { from: 0, to: unified.state.doc.length, insert: right } })
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
    // `mode` matters: which underlying view exists changes with it, so the
    // handle has to be rebuilt.
  }, [onReady, mode])

  return <div ref={host} className="h-full min-h-0 [&>*]:h-full scroll-thin" />
}
