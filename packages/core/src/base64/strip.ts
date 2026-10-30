import { INLINE_MAX_BYTES } from './tiers.ts'

/**
 * What a sanitiser took out of an SVG, normalised so the report does not
 * depend on any one sanitiser's object shapes. The app maps DOMPurify's
 * `removed` entries to these; the engine only counts and groups them.
 */
export type Removal =
  /** `name` is the node name: `script`, `foreignObject`, or `#comment` for a non-element node. */
  | { kind: 'element'; name: string }
  /** `value` lets the report tell a `javascript:` URL from any other disallowed one. */
  | { kind: 'attribute'; name: string; element: string; value?: string }

export type StripCategory =
  | 'script'
  | 'foreign-object'
  | 'embed'
  | 'handler'
  | 'script-url'
  | 'data-url'
  | 'url'
  | 'element'
  | 'attribute'
  | 'node'

export interface StripItem {
  category: StripCategory
  /** What was removed, e.g. `<script>` or `on* handler`. */
  label: string
  count: number
  /** The distinct names behind a grouped item, e.g. `onload`, `onclick`. */
  names: string[]
  /** Would have run script or pulled in other content if the SVG were inlined into a page. */
  dangerous: boolean
  /** `2 on* handlers` -- the count with the label, pluralised. */
  text: string
}

export interface StripReport {
  /** Every removal, counted once each. */
  total: number
  /** The dangerous subset of `total`. */
  dangerous: number
  /** Script first, then handlers, script URLs and embedding; the rest by count. */
  items: StripItem[]
  /** `Stripped 1 <script>, 2 on* handlers` or `Nothing to strip`. */
  summary: string
}

/** Sanitising is a main-thread DOM parse, so only SVGs up to this size are inspected. */
export const SVG_INSPECT_MAX_BYTES = INLINE_MAX_BYTES

const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src', 'action', 'formaction', 'from', 'to', 'values'])
const EMBEDDING = new Set(['iframe', 'object', 'embed', 'frame', 'frameset', 'applet', 'portal'])

/**
 * Browsers ignore ASCII whitespace and control characters inside a URL scheme,
 * so `java\tscript:` still runs. Drop them before looking at the scheme.
 */
function schemeOf(value: string): string | null {
  let compact = ''
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (code <= 0x20 || code === 0x7f || code === 0xa0 || ch === '　') continue
    compact += ch
    if (compact.length > 16) break
  }
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(compact)
  return m ? m[1]!.toLowerCase() : null
}

// The order a reader cares about: what would have executed, then what would
// have pulled other content in, then the merely disallowed.
const RANK: Partial<Record<StripCategory, number>> = {
  script: 0,
  handler: 1,
  'script-url': 2,
  'foreign-object': 3,
  embed: 4,
}

function rank(category: StripCategory): number {
  return RANK[category] ?? 5
}

interface Group {
  category: StripCategory
  label: string
  singular: string
  plural: string
  dangerous: boolean
  names: Set<string>
  count: number
}

function classify(entry: Removal): Omit<Group, 'names' | 'count'> & { key: string; name: string } {
  if (entry.kind === 'element') {
    const name = entry.name
    const lower = name.toLowerCase()
    if (lower.startsWith('#')) {
      const what = lower === '#comment' ? 'comment' : lower === '#text' ? 'text node' : lower.slice(1)
      return { key: `node:${lower}`, name, category: 'node', label: what, singular: what, plural: `${what}s`, dangerous: false }
    }
    const tag = `<${name}>`
    if (lower === 'script') {
      return { key: 'el:script', name, category: 'script', label: '<script>', singular: '<script>', plural: '<script>', dangerous: true }
    }
    if (lower === 'foreignobject') {
      return { key: 'el:foreignobject', name, category: 'foreign-object', label: '<foreignObject>', singular: '<foreignObject>', plural: '<foreignObject>', dangerous: true }
    }
    if (EMBEDDING.has(lower)) {
      return { key: `el:${lower}`, name, category: 'embed', label: tag, singular: tag, plural: tag, dangerous: true }
    }
    return { key: `el:${lower}`, name, category: 'element', label: tag, singular: tag, plural: tag, dangerous: false }
  }

  const name = entry.name
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) {
    return { key: 'attr:on*', name: lower, category: 'handler', label: 'on* handler', singular: 'on* handler', plural: 'on* handlers', dangerous: true }
  }
  if (URL_ATTRIBUTES.has(lower) || lower.endsWith(':href')) {
    const scheme = entry.value === undefined ? null : schemeOf(entry.value)
    if (scheme === 'javascript' || scheme === 'vbscript') {
      const what = `${scheme}: URL`
      return { key: `url:${scheme}`, name: lower, category: 'script-url', label: what, singular: what, plural: `${what}s`, dangerous: true }
    }
    if (scheme === 'data') {
      return { key: 'url:data', name: lower, category: 'data-url', label: 'data: URL', singular: 'data: URL', plural: 'data: URLs', dangerous: false }
    }
    return { key: 'url:other', name: lower, category: 'url', label: 'disallowed URL', singular: 'disallowed URL', plural: 'disallowed URLs', dangerous: false }
  }
  const what = `${lower} attribute`
  return { key: `attr:${lower}`, name: lower, category: 'attribute', label: what, singular: what, plural: `${what}s`, dangerous: false }
}

/** Group and count a sanitiser's removals into something a person can read in one line. */
export function summarizeRemovals(entries: readonly Removal[]): StripReport {
  const groups = new Map<string, Group>()
  for (const entry of entries) {
    const { key, name, ...rest } = classify(entry)
    let group = groups.get(key)
    if (group === undefined) {
      group = { ...rest, names: new Set(), count: 0 }
      groups.set(key, group)
    }
    group.count++
    group.names.add(name)
  }

  const items: StripItem[] = [...groups.values()]
    .map((g) => ({
      category: g.category,
      label: g.label,
      count: g.count,
      names: [...g.names],
      dangerous: g.dangerous,
      text: `${g.count} ${g.count === 1 ? g.singular : g.plural}`,
    }))
    .toSorted((a, b) => rank(a.category) - rank(b.category) || b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))

  const dangerous = items.reduce((n, item) => n + (item.dangerous ? item.count : 0), 0)
  return {
    total: entries.length,
    dangerous,
    items,
    summary: items.length === 0 ? 'Nothing to strip' : `Stripped ${items.map((i) => i.text).join(', ')}`,
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/**
 * A sanitiser that parses as HTML serialises as HTML, which drops nothing an
 * SVG viewer needs except the namespace declarations an inline `<svg>` never
 * had. Add them to the root so the text works as a standalone `.svg` file.
 */
export function standaloneSvg(markup: string): string {
  const m = /<svg\b[^>]*>/i.exec(markup)
  if (!m) return markup
  const tag = m[0]
  let add = ''
  if (!/\sxmlns\s*=/i.test(tag)) add += ` xmlns="${SVG_NS}"`
  if (/\sxlink:[a-z]/i.test(markup) && !/\sxmlns:xlink\s*=/i.test(tag)) add += ` xmlns:xlink="${XLINK_NS}"`
  if (add === '') return markup
  const at = m.index + 4
  return markup.slice(0, at) + add + markup.slice(at)
}
