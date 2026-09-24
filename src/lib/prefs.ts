import { useCallback, useEffect, useState } from 'react'
import { isToolSlug, type ToolSlug } from '@/lib/registry'
import { readLocal, writeLocal } from '@/lib/persist/store'

/**
 * Site-wide preferences: pinned tools and a local usage counter.
 *
 * Stored under a reserved slug so it shares the envelope, quota handling and
 * "clear all data" behaviour of tool state. The usage counter exists only to
 * order the palette's Recent section -- it never leaves the browser.
 */
const PREFS_SLUG = '@prefs'
const PREFS_VERSION = 1

export const MAX_PINS = 9

export interface Prefs {
  pins: ToolSlug[]
  /** slug -> times opened */
  usage: Partial<Record<ToolSlug, number>>
  /** Desktop sidebar collapsed to an icon rail. */
  sidebarCollapsed: boolean
}

const EMPTY: Prefs = { pins: [], usage: {}, sidebarCollapsed: false }

function sanitize(raw: Partial<Prefs> | undefined): Prefs {
  if (!raw) return EMPTY
  const pins = (raw.pins ?? []).filter((s): s is ToolSlug => isToolSlug(s)).slice(0, MAX_PINS)
  const usage: Partial<Record<ToolSlug, number>> = {}
  for (const [slug, count] of Object.entries(raw.usage ?? {})) {
    if (isToolSlug(slug) && typeof count === 'number' && count > 0) usage[slug] = count
  }
  return { pins, usage, sidebarCollapsed: raw.sidebarCollapsed === true }
}

function read(): Prefs {
  return sanitize(readLocal<Partial<Prefs>>(PREFS_SLUG, PREFS_VERSION))
}

function write(prefs: Prefs): void {
  writeLocal(PREFS_SLUG, PREFS_VERSION, prefs)
}

const listeners = new Set<(p: Prefs) => void>()
let current: Prefs | null = null

function get(): Prefs {
  current ??= read()
  return current
}

function update(fn: (p: Prefs) => Prefs): void {
  current = fn(get())
  write(current)
  for (const l of listeners) l(current)
}

export function recordToolUse(slug: ToolSlug): void {
  update((p) => ({ ...p, usage: { ...p.usage, [slug]: (p.usage[slug] ?? 0) + 1 } }))
}

export function toggleSidebar(): void {
  update((p) => ({ ...p, sidebarCollapsed: !p.sidebarCollapsed }))
}

export function togglePin(slug: ToolSlug): void {
  update((p) => {
    if (p.pins.includes(slug)) return { ...p, pins: p.pins.filter((s) => s !== slug) }
    if (p.pins.length >= MAX_PINS) return p
    return { ...p, pins: [...p.pins, slug] }
  })
}

/** Most-used first, for the palette's Recent section. */
export function recentSlugs(prefs: Prefs, limit = 5): ToolSlug[] {
  return Object.entries(prefs.usage)
    .toSorted((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, limit)
    .map(([slug]) => slug as ToolSlug)
}

export function usePrefs(): Prefs {
  const [prefs, setPrefs] = useState<Prefs>(get)
  useEffect(() => {
    listeners.add(setPrefs)
    // Another tab may have changed prefs while this one was mounted.
    const onStorage = () => {
      current = read()
      setPrefs(current)
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(setPrefs)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return prefs
}

export function useToolUsageTracker(slug: ToolSlug): void {
  useEffect(() => {
    recordToolUse(slug)
  }, [slug])
}

export function useTogglePin(): (slug: ToolSlug) => void {
  return useCallback((slug: ToolSlug) => togglePin(slug), [])
}
