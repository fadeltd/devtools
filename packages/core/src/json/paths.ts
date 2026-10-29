/**
 * The three path flavours a tree row can be copied as, and their parsers.
 *
 * - RFC 6901 pointer (`/items/0/id`) -- what JSON Patch and JSON Schema use.
 * - Dot/bracket path (`items[0].id`) -- what you paste into JS/TS code.
 * - jq path (`.items[0].id`) -- what you paste into a terminal.
 *
 * The formatters for the first two live in `embedded.ts`. The parsers exist so
 * that each flavour is proven to round-trip to the *same node*, which is the
 * property that matters: a copied path that points somewhere else is worse
 * than none.
 */

import { toDotPath, toJsonPointer } from './embedded.ts'
import { isRawNumber } from './rawjson.ts'
import { kindOf } from './tree.ts'

export type PathSegment = string | number

// jq's identifier grammar is narrower than JS's: no `$`.
const JQ_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** jq path. Non-identifier keys use `.["key"]`, which every jq since 1.5 reads. */
export function toJqPath(path: readonly PathSegment[]): string {
  if (path.length === 0) return '.'
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += out === '' ? `.[${segment}]` : `[${segment}]`
    else if (JQ_IDENT.test(segment)) out += `.${segment}`
    else out += out === '' ? `.[${JSON.stringify(segment)}]` : `[${JSON.stringify(segment)}]`
  }
  return out
}

/** RFC 6901 pointer to string tokens. Tokens stay strings: "0" may be a key. */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) throw new Error(`Not a JSON pointer: ${pointer}`)
  return pointer
    .slice(1)
    .split('/')
    .map((t) => t.replaceAll('~1', '/').replaceAll('~0', '~'))
}

/**
 * Shared reader for dot paths and jq paths, which differ only in the root
 * marker and the identifier grammar.
 */
function parseAccessors(src: string, start: number, ident: RegExp): PathSegment[] {
  const out: PathSegment[] = []
  let i = start
  while (i < src.length) {
    const ch = src[i]
    if (ch === '.') {
      i++
      if (src[i] === '[') continue
      const m = ident.exec(src.slice(i))
      if (m === null) throw new Error(`Expected a key at ${i}`)
      out.push(m[0])
      i += m[0].length
    } else if (ch === '[') {
      if (src[i + 1] === '"') {
        // Find the closing quote, honouring escapes, then let JSON unescape.
        let j = i + 2
        while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
        out.push(JSON.parse(src.slice(i + 1, j + 1)) as string)
        i = j + 1
      } else {
        const m = /^\d+/.exec(src.slice(i + 1))
        if (m === null) throw new Error(`Expected an index at ${i}`)
        out.push(Number(m[0]))
        i += 1 + m[0].length
      }
      if (src[i] !== ']') throw new Error(`Expected ] at ${i}`)
      i++
    } else if (out.length === 0 && i === start) {
      // A dot path's first key has no leading dot.
      const m = ident.exec(src.slice(i))
      if (m === null) throw new Error(`Unexpected ${ch} at ${i}`)
      out.push(m[0])
      i += m[0].length
    } else {
      throw new Error(`Unexpected ${ch} at ${i}`)
    }
  }
  return out
}

const DOT_IDENT = /^[A-Za-z_$][\w$]*/

/**
 * Also reads a JSONPath-style `$.a[0]` / `$[0]` root. `toDotPath` never writes
 * one (a leading `$` key comes out as `["$"]`), so this cannot misread a path
 * it produced.
 */
export function parseDotPath(path: string): PathSegment[] {
  if (path === '$') return []
  if (path.startsWith('$.') || path.startsWith('$[')) return parseAccessors(path, 1, DOT_IDENT)
  return parseAccessors(path, 0, DOT_IDENT)
}

export function parseJqPath(path: string): PathSegment[] {
  if (path === '.') return []
  if (!path.startsWith('.')) throw new Error(`Not a jq path: ${path}`)
  return parseAccessors(path, 0, /^[A-Za-z_][A-Za-z0-9_]*/)
}

const MISSING = Symbol('missing')

/**
 * Follow a path. Array steps accept a numeric string (pointer tokens are
 * strings); object steps accept a number (so `[0]` on `{"0": …}` resolves the
 * way JS property access would).
 */
export function resolvePath(root: unknown, path: readonly PathSegment[]): unknown {
  let node: unknown = root
  for (const segment of path) {
    if (Array.isArray(node)) {
      const i = typeof segment === 'number' ? segment : /^(0|[1-9]\d*)$/.test(segment) ? Number(segment) : -1
      if (i < 0 || i >= node.length) return MISSING
      node = node[i]
    } else if (node !== null && typeof node === 'object' && !isRawNumber(node)) {
      const key = String(segment)
      if (!Object.hasOwn(node, key)) return MISSING
      node = (node as Record<string, unknown>)[key]
    } else {
      return MISSING
    }
  }
  return node
}

export { MISSING }

export type PathFlavor = 'pointer' | 'dot' | 'jq'

/**
 * Which flavour a typed path is in. The three are told apart by their first
 * character, so detection never has to guess: `/` is a pointer, `.` is jq, and
 * anything else is a dot path.
 */
export function detectPathFlavor(src: string): PathFlavor {
  if (src === '' || src.startsWith('/')) return 'pointer'
  if (src.startsWith('.')) return 'jq'
  return 'dot'
}

export function formatPath(path: readonly PathSegment[], flavor: PathFlavor): string {
  if (flavor === 'pointer') return toJsonPointer(path)
  return flavor === 'jq' ? toJqPath(path) : toDotPath(path)
}

export type Selection =
  | {
      ok: true
      value: unknown
      /** Normalised: array steps are numbers, whatever flavour was typed. */
      path: PathSegment[]
      flavor: PathFlavor
    }
  | { ok: false; message: string; flavor: PathFlavor }

/**
 * Narrow a document to the node a typed path points at, for "filter to this
 * node". Accepts any of the three flavours, and JSONPath's `$.` root.
 * Blank selects the whole document, and so does `/`, which is what the tree's
 * Pointer button copies for the root; RFC 6901 would read it as the `""` key,
 * which stays reachable as `.[""]`.
 *
 * Failures say where the walk stopped, written in the flavour that was typed,
 * because "not found" alone sends you counting brackets.
 */
export function selectPath(root: unknown, src: string): Selection {
  const text = src.trim()
  const flavor = detectPathFlavor(text)
  if (text === '' || text === '/') return { ok: true, value: root, path: [], flavor }

  let segments: PathSegment[]
  try {
    segments =
      flavor === 'pointer'
        ? parsePointer(text)
        : flavor === 'jq'
          ? parseJqPath(text)
          : parseDotPath(text)
  } catch (e) {
    return { ok: false, message: `Not a valid path: ${(e as Error).message}`, flavor }
  }

  const path: PathSegment[] = []
  let node = root
  for (const segment of segments) {
    const here = path.length === 0 ? 'the root' : formatPath(path, flavor)
    const kind = kindOf(node)
    if (kind === 'array') {
      const items = node as unknown[]
      const i =
        typeof segment === 'number' ? segment : /^(0|[1-9]\d*)$/.test(segment) ? Number(segment) : -1
      if (i < 0) {
        const message = `${here} is an array; ${JSON.stringify(segment)} is not an index`
        return { ok: false, message, flavor }
      }
      if (i >= items.length) {
        const noun = items.length === 1 ? 'item' : 'items'
        return { ok: false, message: `${here} has ${items.length} ${noun}; there is no [${i}]`, flavor }
      }
      path.push(i)
      node = items[i]
    } else if (kind === 'object') {
      const key = String(segment)
      if (!Object.hasOwn(node as object, key)) {
        return { ok: false, message: `${here} has no key ${JSON.stringify(key)}`, flavor }
      }
      path.push(key)
      node = (node as Record<string, unknown>)[key]
    } else {
      return { ok: false, message: `${here} is a ${kind}, so it has no children`, flavor }
    }
  }
  return { ok: true, value: node, path, flavor }
}
