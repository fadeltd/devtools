import { TOOLS_BY_SLUG, type ToolSlug } from '@/lib/registry'
import { readIdb, writeIdb } from './idb'
import { readLocal, writeLocal } from './store'

/**
 * Seed another tool's saved state before navigating to it -- e.g. the JSON
 * tool opening its auto-fix preview in Diff.
 *
 * The patch is merged over whatever the target has stored, and `useToolState`
 * merges that over the tool's own defaults on mount, so the caller only names
 * the fields it means to set and never needs the target's module (importing it
 * would pull that tool's chunk into the caller's).
 *
 * Resolves false for a `store: 'none'` tool (there is nowhere to put it) or a
 * failed write, so the caller can stay put instead of opening an empty tool.
 */
export async function handOff<T extends object>(slug: ToolSlug, patch: Partial<T>): Promise<boolean> {
  const tool = TOOLS_BY_SLUG[slug]
  const version = tool.stateVersion

  if (tool.store.kind === 'idb') {
    const current = (await readIdb<T>(slug, version)) ?? {}
    return writeIdb(slug, version, { ...current, ...patch })
  }
  if (tool.store.kind === 'local') {
    const current = readLocal<T>(slug, version) ?? {}
    return writeLocal(slug, version, { ...current, ...patch }) === 'ok'
  }
  return false
}
