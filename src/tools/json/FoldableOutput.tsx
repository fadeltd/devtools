import { useEffect, useRef } from 'react'
import { Compartment, EditorState, type StateEffect } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { codeFolding, foldEffect, foldGutter, foldKeymap, unfoldAll } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { getSearchQuery, openSearchPanel, search, searchKeymap, SearchQuery, setSearchQuery } from '@codemirror/search'
import { foldRanges } from '@fadeltd/devtools-core/json'
import { editorTheme } from '@/lib/codemirror/theme'

/**
 * The formatted output in a read-only CodeMirror view with a fold gutter, the
 * way an editor shows JSON. Loaded lazily by JsonTool, so CodeMirror never
 * reaches the entry bundle or the JSON route chunk; the plain textarea stands
 * in while this loads, and keeps the jobs this cannot do well (the large tier,
 * touch screens, non-JSON text).
 *
 * Deliberately monochrome: lang-json is here for its syntax tree, which is
 * what folding reads, not for highlighting. Colour in this app means diff or
 * validation.
 */

export interface FoldApi {
  /** Fold every object and array below the root, at every depth. */
  foldAll: () => void
  unfoldAll: () => void
  /** Open the find panel: the browser's own find sees only rendered lines. */
  find: () => void
}

/** The fold gutter and placeholder in the app's tokens. */
const foldTheme = EditorView.theme(
  {
    '.cm-scroller': {
      scrollbarWidth: 'thin',
      scrollbarColor: 'var(--color-border-strong) transparent',
    },
    '.cm-foldGutter .cm-gutterElement': {
      width: '18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: 'var(--color-faint)',
    },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--color-fg)' },
    '.cm-foldMarker': { display: 'flex', padding: '0' },
    '.cm-foldMarker-closed': { color: 'var(--color-muted)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-surface-2)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: '3px',
      color: 'var(--color-muted)',
      margin: '0 2px',
      padding: '0 4px',
      cursor: 'pointer',
    },
    '.cm-foldPlaceholder:hover': { color: 'var(--color-fg)' },

    // The find panel, as a toolbar row. Matches use the accent: they are a
    // selection state, not a diff or validation colour.
    '.cm-panels': {
      backgroundColor: 'var(--color-surface)',
      color: 'var(--color-fg)',
    },
    '.cm-panels-top': { borderBottom: '1px solid var(--color-border)' },
    '.cm-panel.cm-search': {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 32px 6px 8px',
      fontFamily: 'var(--font-sans)',
      fontSize: '12px',
    },
    '.cm-panel.cm-search br': { display: 'none' },
    // Regex search would run a user pattern on the main thread; see the guard
    // in the extensions below.
    '.cm-panel.cm-search label:has(input[name=re])': { display: 'none' },
    '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-muted)' },
    '.cm-textfield': {
      height: '28px',
      backgroundColor: 'var(--color-bg)',
      color: 'var(--color-fg)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: '4px',
      padding: '0 8px',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
    },
    '.cm-textfield:focus': { outline: '1px solid var(--color-accent)', outlineOffset: '-1px' },
    '.cm-button': {
      height: '28px',
      backgroundColor: 'var(--color-surface-2)',
      backgroundImage: 'none',
      color: 'var(--color-fg)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: '4px',
      padding: '0 10px',
      fontSize: '12px',
    },
    '.cm-panel.cm-search [name=close]': {
      color: 'var(--color-muted)',
      fontSize: '16px',
      top: '6px',
      right: '8px',
    },
    '.cm-searchMatch': { backgroundColor: 'var(--color-accent-dim)' },
    '.cm-searchMatch-selected': { backgroundColor: 'var(--color-accent)', color: 'var(--color-bg)' },
  },
  { dark: true },
)

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Lucide's chevrons, built as DOM: down when open, right when folded. */
function marker(open: boolean): HTMLElement {
  const span = document.createElement('span')
  span.className = open ? 'cm-foldMarker' : 'cm-foldMarker cm-foldMarker-closed'
  span.title = open ? 'Fold' : 'Unfold'
  const svg = document.createElementNS(SVG_NS, 'svg')
  for (const [k, v] of Object.entries({
    width: '12',
    height: '12',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(k, v)
  }
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', open ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6')
  svg.append(path)
  span.append(svg)
  return span
}

const wrapping = new Compartment()

/**
 * Fold every object and array below the root, so the top level reads as a
 * list of collapsed members that each open a level at a time. CodeMirror's own
 * `foldAll` folds only outermost ranges, which in a JSON document is the root
 * itself: one `{…}` line.
 *
 * The ranges come from a bracket scan of the text (~13 ms for 2 MB) rather
 * than the syntax tree, which would mean parsing the whole document first
 * (~0.8 s); they have the same bounds as lang-json's own folds.
 */
function foldBelowRoot(view: EditorView) {
  const effects: StateEffect<unknown>[] = foldRanges(view.state.doc.toString(), { minDepth: 1 }).map((r) =>
    foldEffect.of({ from: r.from, to: r.to }),
  )
  if (effects.length > 0) view.dispatch({ effects })
}

/** Turns regex search back off should anything switch it on. */
const literalSearchOnly = EditorView.updateListener.of((update) => {
  const query = getSearchQuery(update.state)
  if (!query.regexp) return
  update.view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({ search: query.search, caseSensitive: query.caseSensitive, wholeWord: query.wholeWord }),
    ),
  })
})

/**
 * The smallest single replacement that turns `prev` into `next`: typing in the
 * input changes a few lines of the output, and replacing only those keeps the
 * scroll position and every fold outside them.
 */
function minimalChange(prev: string, next: string) {
  const max = Math.min(prev.length, next.length)
  let start = 0
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  let endPrev = prev.length
  let endNext = next.length
  while (
    endPrev > start &&
    endNext > start &&
    prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)
  ) {
    endPrev--
    endNext--
  }
  // Never split a surrogate pair.
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--
  if (endPrev < prev.length && isLowSurrogate(prev.charCodeAt(endPrev))) {
    endPrev++
    endNext++
  }
  return { from: start, to: endPrev, insert: next.slice(start, endNext) }
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff
}

export default function FoldableOutput({
  value,
  wrap,
  onReady,
}: {
  value: string
  /** Soft-wrap long lines; off when a line is long enough to make that slow. */
  wrap: boolean
  /** Called with the fold commands once the view exists, and null on unmount. */
  onReady?: (api: FoldApi | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // The text the view holds, compared by reference instead of building a copy
  // of the document with `doc.toString()` on every render.
  const shown = useRef('')

  // Latest props via a ref, so the view is created once per mount. Assigned in
  // an effect declared first, so it runs before the ones that read it.
  const latest = useRef({ value, wrap, onReady })
  useEffect(() => {
    latest.current = { value, wrap, onReady }
  })

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const initial = latest.current
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial.value,
        extensions: [
          lineNumbers(),
          foldGutter({ markerDOM: marker }),
          codeFolding(),
          json(),
          editorTheme,
          foldTheme,
          keymap.of([...foldKeymap, ...searchKeymap]),
          search({ top: true }),
          literalSearchOnly,
          // Focusable and selectable, so keyboard folding, select-all and copy
          // work; readOnly is what refuses input.
          EditorView.editable.of(true),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ 'aria-label': 'Formatted output' }),
          wrapping.of(initial.wrap ? EditorView.lineWrapping : []),
        ],
      }),
    })
    viewRef.current = view
    shown.current = initial.value
    initial.onReady?.({
      foldAll: () => foldBelowRoot(view),
      unfoldAll: () => void unfoldAll(view),
      find: () => void openSearchPanel(view),
    })
    return () => {
      latest.current.onReady?.(null)
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || value === shown.current) return
    view.dispatch({ changes: minimalChange(shown.current, value) })
    shown.current = value
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view || (wrapping.get(view.state) === EditorView.lineWrapping) === wrap) return
    view.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  return <div ref={host} className="min-h-0 w-full flex-1 overflow-hidden" />
}
