export type Scope = 'global' | 'tool'

export interface Shortcut {
  /** Canonical and normalized: 'mod+k', 'mod+shift+c', '?', 'alt+arrowdown'. */
  readonly combo: string
  /** Shown in the cheatsheet. */
  readonly label: string
  /** Cheatsheet section heading. */
  readonly group: string
  readonly scope: Scope
  /**
   * Fire even while a textarea or input has focus. Every tool here is a giant
   * textarea, so anything without a modifier must opt in explicitly or it would
   * be unusable.
   */
  readonly whileTyping?: boolean
  readonly run: (e: KeyboardEvent) => void
}
