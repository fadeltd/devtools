import { useSyncExternalStore } from 'react'

/** Below md: 44px touch targets, and the layout stacks. */
const NARROW = '(max-width: 47.99rem)'

function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** Whether the viewport is below md, kept current as it resizes. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  )
}
