import { EditorView } from '@codemirror/view'

/**
 * Matches the app's design tokens so an editor does not look bolted on:
 * 44px right-aligned line-number gutter on its own darker surface, and
 * 12px/18px tabular mono. Shared by the Diff and JSON tools; each adds its
 * own rules on top.
 */
export const editorTheme = EditorView.theme(
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
  },
  { dark: true },
)
