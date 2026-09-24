import { Binary, Braces, GitCompare, ListOrdered, Sigma } from 'lucide-react'
import type { ToolDef } from './types'

/**
 * The single source of truth. This array drives the router, the home grid, the
 * sidebar, the command palette, the build-time prerender and the sitemap.
 *
 * Adding a tool = one folder under src/tools/ + one entry here. If a change
 * needs the router or the sitemap script edited by hand, this abstraction has
 * been broken -- fix that instead of working around it.
 */
const RAW_TOOLS = [
  {
    slug: 'diff',
    title: 'Diff Checker',
    blurb: 'Compare two blocks of text side by side or unified, with word-level highlighting.',
    keywords: ['diff', 'compare', 'changes', 'difference', 'diffchecker', 'merge', 'patch'],
    category: 'text',
    icon: GitCompare,
    load: () => import('@/tools/diff/DiffTool'),
    store: { kind: 'idb' },
    stateVersion: 1,
    status: 'beta',
  },
  {
    slug: 'text-stats',
    title: 'Text Statistics',
    blurb:
      'Count characters, letters, words, sentences and lines, with word frequency and reading time.',
    keywords: [
      'text statistics',
      'stats',
      'count',
      'character count',
      'letter count',
      'word count',
      'line count',
      'sentence count',
      'paragraph count',
      'keyword density',
      'word frequency',
      'reading time',
      'wordcount',
    ],
    category: 'text',
    icon: Sigma,
    load: () => import('@/tools/text-stats/TextStatsTool'),
    store: { kind: 'local' },
    stateVersion: 1,
    status: 'beta',
  },
  {
    slug: 'base64',
    title: 'Base64',
    blurb: 'Encode and decode base64 and base64url, with correct UTF-8 and data: URI handling.',
    keywords: ['base64', 'b64', 'base64url', 'encode', 'decode', 'data uri', 'atob', 'btoa'],
    category: 'encoding',
    icon: Binary,
    load: () => import('@/tools/base64/Base64Tool'),
    store: { kind: 'idb' },
    stateVersion: 1,
    status: 'beta',
  },
  {
    slug: 'list',
    title: 'List Tools',
    blurb: 'Sort, natural-sort, dedupe, shuffle and reverse lines without mangling your input.',
    keywords: [
      'list',
      'lines',
      'sort',
      'natural sort',
      'dedupe',
      'unique',
      'uniq',
      'duplicate',
      'shuffle',
      'randomize',
      'reverse',
    ],
    category: 'list',
    icon: ListOrdered,
    load: () => import('@/tools/list/ListTool'),
    store: { kind: 'local' },
    stateVersion: 1,
    status: 'beta',
  },
  {
    slug: 'json',
    title: 'JSON Formatter',
    blurb: 'Pretty-print, minify, sort keys and validate JSON with precise error positions.',
    keywords: ['json', 'format', 'beautify', 'pretty', 'prettify', 'minify', 'validate', 'lint'],
    category: 'data',
    icon: Braces,
    load: () => import('@/tools/json/JsonTool'),
    store: { kind: 'local' },
    stateVersion: 1,
    status: 'beta',
  },
] as const satisfies readonly ToolDef[]

/** The literal union that keeps persistence keys, links and pins honest. */
export type ToolSlug = (typeof RAW_TOOLS)[number]['slug']

/**
 * `as const satisfies` above buys the literal slug union, but it also narrows
 * every other field to what today's entries happen to declare -- which would
 * make `store.kind === 'none'` a type error until some tool declares it, and
 * hide `hidden` entirely. Widening back to ToolDef here keeps the union and
 * restores the full declared shape.
 */
export type Tool = ToolDef & { readonly slug: ToolSlug }

export const TOOLS: readonly Tool[] = RAW_TOOLS

export const TOOLS_BY_SLUG = Object.fromEntries(
  TOOLS.map((t) => [t.slug, t]),
) as Record<ToolSlug, Tool>

export const VISIBLE_TOOLS: readonly Tool[] = TOOLS.filter((t) => !t.hidden)

export function isToolSlug(value: string): value is ToolSlug {
  return Object.hasOwn(TOOLS_BY_SLUG, value)
}

/**
 * Warm a tool's lazy chunk. Called on palette highlight and card hover, so the
 * navigation itself is instant. The module cache dedupes repeat calls.
 */
export function warmTool(slug: string): void {
  if (isToolSlug(slug)) void TOOLS_BY_SLUG[slug].load()
}

export type { ToolDef, ToolCategory, StoreKind } from './types'
export { CATEGORIES, CATEGORY_LABELS } from './types'
