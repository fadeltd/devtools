import type { Scope, Shortcut } from './types'

const shortcuts = new Map<string, Shortcut>()
let listening = false

function id(scope: Scope, combo: string): string {
  return `${scope}:${combo}`
}

/** Normalize a combo string so 'Mod+Shift+C' and 'shift+mod+c' are one key. */
export function normalizeCombo(combo: string): string {
  const parts = combo.toLowerCase().split('+').filter(Boolean)
  const mods = ['mod', 'ctrl', 'alt', 'shift'].filter((m) => parts.includes(m))
  const key = parts.find((p) => !['mod', 'ctrl', 'alt', 'shift'].includes(p)) ?? ''
  return [...mods, key].filter(Boolean).join('+')
}

/** Build the combo string for an actual keypress, to look it up. */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.altKey) parts.push('alt')

  let key = e.key.toLowerCase()
  if (key === ' ') key = 'space'

  // '?' already requires Shift on most layouts, so folding Shift in would make
  // it unmatchable. Only record Shift for keys where it is not implied.
  if (e.shiftKey && key.length > 1) parts.push('shift')
  else if (e.shiftKey && /^[a-z]$/.test(key)) parts.push('shift')

  parts.push(key)
  return parts.join('+')
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return
  const combo = comboFromEvent(e)
  const hit = shortcuts.get(id('tool', combo)) ?? shortcuts.get(id('global', combo))
  if (!hit) return

  // Typing guard: a bare-letter shortcut must not fire inside a textarea.
  const hasModifier = e.metaKey || e.ctrlKey || e.altKey
  if (isTypingTarget(e.target) && !hasModifier && hit.whileTyping !== true) return

  e.preventDefault()
  hit.run(e)
}

function ensureListening(): void {
  if (listening || typeof window === 'undefined') return
  window.addEventListener('keydown', onKeyDown)
  listening = true
}

export function registerShortcuts(list: readonly Shortcut[]): () => void {
  ensureListening()
  const added: string[] = []

  for (const s of list) {
    const combo = normalizeCombo(s.combo)
    const key = id(s.scope, combo)
    if (shortcuts.has(key)) {
      // With this many tools, a silent collision means one shortcut mysteriously
      // stops working. Fail loudly in dev, degrade quietly in production.
      const message = `[keys] duplicate shortcut "${key}" (${s.label})`
      if (import.meta.env.DEV) throw new Error(message)
      console.warn(message)
      continue
    }
    shortcuts.set(key, { ...s, combo })
    added.push(key)
  }

  return () => {
    for (const key of added) shortcuts.delete(key)
  }
}

/** The cheatsheet renders this, so documentation cannot drift from behaviour. */
export function listShortcuts(): Shortcut[] {
  return [...shortcuts.values()]
}

export type { Shortcut, Scope } from './types'
