export const IS_MAC =
  typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)

/** Touch-only devices have no keyboard, so shortcut UI is hidden there. */
export const HAS_KEYBOARD =
  typeof window === 'undefined' || !window.matchMedia('(hover: none)').matches

const SYMBOLS: Record<string, string> = {
  mod: IS_MAC ? '⌘' : 'Ctrl',
  meta: '⌘',
  ctrl: 'Ctrl',
  alt: IS_MAC ? '⌥' : 'Alt',
  shift: IS_MAC ? '⇧' : 'Shift',
  enter: '↵',
  escape: 'Esc',
  backspace: '⌫',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
}

/** 'mod+shift+c' -> '⌘⇧C' on Mac, 'Ctrl+Shift+C' elsewhere. */
export function renderCombo(combo: string): string {
  const parts = combo.split('+').map((p) => SYMBOLS[p] ?? (p.length === 1 ? p.toUpperCase() : p))
  return IS_MAC ? parts.join('') : parts.join('+')
}
