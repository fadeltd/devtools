import { EditorView } from '@codemirror/view'
import { editorTheme } from '@/lib/codemirror/theme'

/**
 * The shared editor theme plus the design system's diff spec: the semantic
 * add/del colours at 12% background tint with full-strength foreground.
 */
export const diffTheme = [
  editorTheme,
  EditorView.theme(
    {
      '.cm-changedLine': { backgroundColor: 'var(--color-warn-bg)' },
      '.cm-changedText': { backgroundColor: 'rgb(245 158 11 / 0.25)' },
      '.cm-insertedLine': { backgroundColor: 'var(--color-add-bg)' },
      '.cm-deletedLine': { backgroundColor: 'var(--color-del-bg)' },
      '.cm-deletedChunk': { backgroundColor: 'var(--color-del-bg)' },
      '.cm-deletedChunk .cm-deletedText': { backgroundColor: 'rgb(239 68 68 / 0.25)' },

      '.cm-collapsedLines': {
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-muted)',
        padding: '2px 8px',
        fontSize: '11px',
        letterSpacing: '0.02em',
        cursor: 'pointer',
        borderTop: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)',
      },
      '.cm-collapsedLines:hover': { color: 'var(--color-fg)' },

      '.cm-merge-gap': { backgroundColor: 'var(--color-gutter)' },
      '.cm-merge-spacer': { backgroundColor: 'var(--color-bg)' },
    },
    { dark: true },
  ),
]
