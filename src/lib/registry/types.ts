import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

export const CATEGORIES = [
  'text',
  'list',
  'encoding',
  'data',
  'crypto',
  'generate',
  'color',
  'web',
] as const

export type ToolCategory = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  text: 'Text',
  list: 'Lists',
  encoding: 'Encoding',
  data: 'Data',
  crypto: 'Crypto',
  generate: 'Generate',
  color: 'Color',
  web: 'Web',
}

/**
 * Where a tool's last-used state is written.
 *
 * `none` is not an optimisation, it is a safety requirement: anything handling a
 * credential (JWTs, passphrases, generated passwords) must declare it, and the
 * tool then renders a visible "Not saved" badge so the behaviour is observable
 * rather than merely documented.
 */
export type StoreKind =
  | { kind: 'none'; reason: string }
  | { kind: 'local' }
  | { kind: 'idb' }

export interface ToolDef {
  readonly slug: string
  readonly title: string
  /** One line. Doubles as the <meta description> for the prerendered page. */
  readonly blurb: string
  /** Extra palette search terms: aliases, competitor names, verbs. */
  readonly keywords: readonly string[]
  readonly category: ToolCategory
  readonly icon: LucideIcon
  /** The one code-splitting seam. Also the prefetch primitive (see warmTool). */
  readonly load: () => Promise<{ default: ComponentType }>
  readonly store: StoreKind
  /** Bump to invalidate persisted state after a shape change. No migrations. */
  readonly stateVersion: number
  readonly status?: 'stable' | 'beta'
  /** Hidden from the grid, the palette and the sitemap, but still routable. */
  readonly hidden?: boolean
}
