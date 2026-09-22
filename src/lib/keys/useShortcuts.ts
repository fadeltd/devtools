import { useEffect, useRef } from 'react'
import { registerShortcuts } from './registry'
import type { Shortcut } from './types'

/**
 * Register shortcuts for the lifetime of a component.
 *
 * `run` is invoked through a ref so callers can pass inline closures without
 * re-registering on every render (which would trip the duplicate-combo check).
 * Only the set of combos causes a re-registration.
 */
export function useShortcuts(list: readonly Shortcut[]): void {
  const ref = useRef(list)

  // Declared before the registration effect, so the ref is always current by
  // the time a re-registration reads it.
  useEffect(() => {
    ref.current = list
  })

  // A digest of the combo set: re-registration happens when the bindings
  // actually change, not when a caller passes fresh inline closures.
  const combos = list.map((s) => `${s.scope}:${s.combo}`).join('|')

  useEffect(() => {
    if (combos === '') return
    const stable = combos.split('|').map((_, i) => {
      const s = ref.current[i]!
      return { ...s, run: (e: KeyboardEvent) => ref.current[i]?.run(e) }
    })
    return registerShortcuts(stable)
  }, [combos])
}
