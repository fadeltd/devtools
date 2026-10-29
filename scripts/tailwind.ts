/**
 * Find Tailwind classes that have a canonical spelling, using Tailwind's own
 * canonicalizer -- the engine behind the editor's "can be written as" hints.
 *
 * Only string and template literals are inspected (parsed with oxc via Vite),
 * never JSX text, so an apostrophe in "Don't" cannot open a fake string.
 * Each token is canonicalized on its own: collapsing `mt-2 mb-2` into `my-2`
 * would change which classes a conditional `cn()` branch toggles.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { __unstable__loadDesignSystem } from '@tailwindcss/node'
import { parseAst } from 'vite'

export interface Finding {
  file: string
  line: number
  column: number
  /** Absolute offset of the token in the file. */
  offset: number
  from: string
  to: string
}

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>

const ROOT = join(import.meta.dirname, '..')
const CSS_ENTRY = join(ROOT, 'src/styles/global.css')

export async function loadDesignSystem(): Promise<DesignSystem> {
  return __unstable__loadDesignSystem(readFileSync(CSS_ENTRY, 'utf8'), {
    base: join(ROOT, 'src/styles'),
  })
}

export function sourceFiles(dir = join(ROOT, 'src')): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (name.endsWith('.tsx')) out.push(path)
  }
  return out
}

interface Segment {
  start: number
  text: string
}

/** Raw text of every string literal and template chunk, with its offset. */
function stringSegments(source: string): Segment[] {
  const segments: Segment[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node === null || typeof node !== 'object') return
    const n = node as { type?: string; start: number; end: number; value?: unknown }
    if (n.type === 'Literal' && typeof n.value === 'string') {
      // start/end include the quotes.
      segments.push({ start: n.start + 1, text: source.slice(n.start + 1, n.end - 1) })
    } else if (n.type === 'TemplateElement') {
      // oxc's span includes the opening delimiter (` or }) and the closing one
      // (` or ${), so the raw text starts one character in.
      const { raw } = n.value as { raw: string }
      segments.push({ start: n.start + 1, text: raw })
    }
    for (const key in n) {
      if (key !== 'type' && key !== 'start' && key !== 'end') visit((n as Record<string, unknown>)[key])
    }
  }
  visit(parseAst(source, { lang: 'tsx' }))
  return segments
}

export function findInSource(
  file: string,
  source: string,
  canonical: (token: string) => string,
): Finding[] {
  const findings: Finding[] = []
  for (const segment of stringSegments(source)) {
    for (const match of segment.text.matchAll(/\S+/g)) {
      const from = match[0]
      const to = canonical(from)
      if (to === from) continue
      const offset = segment.start + match.index
      const before = source.slice(0, offset)
      const line = before.split('\n').length
      findings.push({ file, line, column: offset - before.lastIndexOf('\n'), offset, from, to })
    }
  }
  return findings
}

export function canonicalizer(ds: DesignSystem): (token: string) => string {
  const cache = new Map<string, string>()
  return (token) => {
    let hit = cache.get(token)
    if (hit === undefined) {
      // rem: 16 is what turns `w-[220px]` into `w-55`, as the editor suggests.
      hit = ds.canonicalizeCandidates([token], { rem: 16 })[0] ?? token
      cache.set(token, hit)
    }
    return hit
  }
}

export async function findNonCanonical(files = sourceFiles()): Promise<Finding[]> {
  const canonical = canonicalizer(await loadDesignSystem())
  return files.flatMap((file) => findInSource(relative(ROOT, file), readFileSync(file, 'utf8'), canonical))
}

/** Apply findings for one file, last offset first so earlier offsets stay valid. */
export function applyFindings(source: string, findings: Finding[]): string {
  let out = source
  for (const f of findings.toSorted((a, b) => b.offset - a.offset)) {
    out = out.slice(0, f.offset) + f.to + out.slice(f.offset + f.from.length)
  }
  return out
}
