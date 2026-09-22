import { clearAllIdb } from './idb'
import { clearAllLocal } from './store'

/** Wipe everything this site has stored, then reload so no stale state lingers. */
export async function clearAllData(): Promise<void> {
  clearAllLocal()
  await clearAllIdb()
  location.reload()
}
