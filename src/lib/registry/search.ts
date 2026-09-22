import { VISIBLE_TOOLS, type Tool } from './index'
import { CATEGORY_LABELS } from './types'

export interface ScoredTool {
  tool: Tool
  score: number
}

/**
 * Weighted scorer over title + keywords + category.
 *
 * Deliberately not Fuse.js: for a few dozen tools a 30-line scorer is faster,
 * more predictable, and costs zero bytes. cmdk's own filter only sees rendered
 * text, so the palette passes shouldFilter={false} and uses this instead.
 */
export function scoreTool(tool: Tool, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1

  const title = tool.title.toLowerCase()
  const slug = tool.slug.toLowerCase()

  if (slug === q || title === q) return 1000
  if (slug.startsWith(q)) return 900
  if (title.startsWith(q)) return 850

  // Initials: "jf" -> "JSON Formatter"
  const initials = title
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
  if (initials.startsWith(q)) return 800

  if (title.includes(q)) return 700
  if (slug.includes(q)) return 650

  let best = 0
  for (const kw of tool.keywords) {
    const k = kw.toLowerCase()
    if (k === q) best = Math.max(best, 600)
    else if (k.startsWith(q)) best = Math.max(best, 500)
    else if (k.includes(q)) best = Math.max(best, 400)
  }
  if (best) return best

  if (CATEGORY_LABELS[tool.category].toLowerCase().includes(q)) return 300
  if (tool.blurb.toLowerCase().includes(q)) return 200

  return 0
}

export function searchTools(query: string): Tool[] {
  const scored: ScoredTool[] = []
  for (const tool of VISIBLE_TOOLS) {
    const score = scoreTool(tool, query)
    if (score > 0) scored.push({ tool, score })
  }
  // Stable within equal scores: sorting has been spec-stable since ES2019.
  return scored.toSorted((a, b) => b.score - a.score).map((s) => s.tool)
}
