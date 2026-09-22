import { EditorView } from '@codemirror/view'

/**
 * Matches the app's design tokens so the editor does not look bolted on.
 * Follows the design system's diff spec: 44px right-aligned line-number gutter
 * on its own darker surface, 12px/18px tabular mono, and the semantic add/del
 * colours at 12% background tint with full-strength foreground.
 */
export const diffTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--color-bg)',
      color: 'var(--color-fg)',
      height: '100%',
      fontSize: '12px',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
      lineHeight: '18px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-gutter)',
      color: 'var(--color-faint)',
      border: 'none',
      borderRight: '1px solid var(--color-border)',
      userSelect: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '44px',
      padding: '0 6px 0 0',
      textAlign: 'right',
    },
    '.cm-activeLine': { backgroundColor: 'rgb(255 255 255 / 0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-muted)' },
    '.cm-content': { caretColor: 'var(--color-accent)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--color-accent-dim)' },

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
)
