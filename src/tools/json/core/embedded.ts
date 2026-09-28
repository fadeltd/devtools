/**
 * Find and expand JSON that has been serialised *into a string* inside other
 * JSON.
 *
 * This is the shape every structured log emitter produces -- the payload,
 * context or body field arrives as `"{\"userId\":42}"` -- and reading it means
 * copying the string out, unescaping it, and pasting it into another tab. Often
 * twice, because it is double-encoded.
 *
 * Expansion is a *view*, never an edit: the source text stays the source of
 * truth and the expanded value is re-derived from it, so turning the toggle off
 * restores the original exactly. There is deliberately no inverse transform to
 * get wrong.
 */

import { isRawNumber } from './rawjson'

/** RFC 6901: "~" becomes "~0" and "/" becomes "~1", in that order. */
export function escapePointerToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1')
}

export function toJsonPointer(path: readonly (string | number)[]): string {
  if (path.length === 0) return ''
  return '/' + path.map((p) => escapePointerToken(String(p))).join('/')
}

/** Dot/bracket path, which is what people actually paste into code. */
export function toDotPath(path: readonly (string | number)[]): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    // A bare leading `$` would read back as the root marker.
    else if (/^[A-Za-z_$][\w$]*$/.test(segment) && !(out === '' && segment === '$')) {
      out += out === '' ? segment : `.${segment}`
    }
    else out += `[${JSON.stringify(segment)}]`
  }
  return out === '' ? '$' : out
}

export interface Embedded {
  /** RFC 6901 pointer to the string value that holds the embedded JSON. */
  pointer: string
  path: (string | number)[]
  dotPath: string
  /** 1 for directly embedded, 2 for embedded inside an embedded value, ... */
  depth: number
  /** Length of the raw string, so the UI can show what it saved you reading. */
  rawLength: number
  /** 'object' or 'array' -- we never expand a string that parses to a scalar. */
  kind: 'object' | 'array'
}

export interface EmbeddedOptions {
  /**
   * How many levels of nesting to unwrap. Real double-encoded logs need 2-3;
   * the cap stops a pathological document from looping.
   */
  maxDepth?: number
  /** Strings longer than this are skipped, to bound the cost of the scan. */
  maxStringLength?: number
  /**
   * How to parse a candidate string. Lossless mode passes `parseLossless`, so a
   * big number inside an embedded payload keeps its digits too.
   */
  parse?: (text: string) => unknown
}

const DEFAULTS: Required<EmbeddedOptions> = {
  maxDepth: 6,
  maxStringLength: 2_000_000,
  parse: (text) => JSON.parse(text) as unknown,
}

/**
 * Decide whether a string is embedded JSON worth expanding.
 *
 * Only objects and arrays qualify. A string like "42" or "true" parses fine,
 * but expanding it would silently retype the data -- the author wrote a string,
 * and showing a number instead would be a lie about the document.
 */
export function parseEmbedded(
  value: string,
  maxStringLength = DEFAULTS.maxStringLength,
  parse = DEFAULTS.parse,
): { kind: 'object' | 'array'; parsed: unknown } | null {
  if (value.length > maxStringLength) return null

  const trimmed = value.trim()
  // Cheap gate first: JSON.parse on every string in a large document is slow.
  const first = trimmed[0]
  if (first !== '{' && first !== '[') return null
  const last = trimmed[trimmed.length - 1]
  if (first === '{' && last !== '}') return null
  if (first === '[' && last !== ']') return null

  let parsed: unknown
  try {
    parsed = parse(trimmed)
  } catch {
    return null
  }

  if (parsed === null || typeof parsed !== 'object') return null
  return { kind: Array.isArray(parsed) ? 'array' : 'object', parsed }
}

function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object' && !isRawNumber(value)
}

/**
 * Locate every embedded JSON string, including ones that only become visible
 * after an outer layer is expanded.
 */
export function findEmbeddedJson(root: unknown, options: EmbeddedOptions = {}): Embedded[] {
  const { maxDepth, maxStringLength, parse } = { ...DEFAULTS, ...options }
  const found: Embedded[] = []

  const walk = (node: unknown, path: (string | number)[], depth: number): void => {
    if (depth > maxDepth) return

    if (typeof node === 'string') {
      const hit = parseEmbedded(node, maxStringLength, parse)
      if (hit) {
        found.push({
          pointer: toJsonPointer(path),
          path: [...path],
          dotPath: toDotPath(path),
          depth,
          rawLength: node.length,
          kind: hit.kind,
        })
        // Recurse into what we just revealed: double-encoded payloads are the
        // common case, not the exotic one.
        walk(hit.parsed, path, depth + 1)
      }
      return
    }

    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, [...path, i], depth))
      return
    }

    if (isPlainContainer(node)) {
      for (const [key, child] of Object.entries(node)) walk(child, [...path, key], depth)
    }
  }

  walk(root, [], 1)
  return found
}

export interface ExpandResult {
  value: unknown
  /** Every string that was expanded, in document order. */
  expanded: Embedded[]
}

/**
 * Return a copy of `root` with embedded JSON strings replaced by their parsed
 * value.
 *
 * `only` restricts expansion to specific pointers; omitting it expands
 * everything found. The input is never mutated.
 */
export function expandEmbedded(
  root: unknown,
  options: EmbeddedOptions & { only?: ReadonlySet<string> } = {},
): ExpandResult {
  const { maxDepth, maxStringLength, parse } = { ...DEFAULTS, ...options }
  const only = options.only
  const expanded: Embedded[] = []

  const transform = (node: unknown, path: (string | number)[], depth: number): unknown => {
    if (depth > maxDepth) return node

    if (typeof node === 'string') {
      const pointer = toJsonPointer(path)
      if (only !== undefined && !only.has(pointer)) return node

      const hit = parseEmbedded(node, maxStringLength, parse)
      if (!hit) return node

      expanded.push({
        pointer,
        path: [...path],
        dotPath: toDotPath(path),
        depth,
        rawLength: node.length,
        kind: hit.kind,
      })
      // Recurse at the same path: a doubly-encoded string sits at the same
      // pointer once unwrapped.
      return transform(hit.parsed, path, depth + 1)
    }

    if (Array.isArray(node)) {
      return node.map((child, i) => transform(child, [...path, i], depth))
    }

    if (isPlainContainer(node)) {
      // fromEntries defines own properties; `out[key] = v` would treat a
      // "__proto__" key as the prototype setter and drop it from the output.
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [key, transform(child, [...path, key], depth)]),
      )
    }

    return node
  }

  return { value: transform(root, [], 1), expanded }
}

export interface EmbeddedField {
  pointer: string
  dotPath: string
  rawLength: number
  /**
   * The embedded field this one lives inside, if any. It only exists once that
   * field is expanded, so selecting it alone does nothing.
   */
  parent: string | null
}

/**
 * Per-field toggles need to know which fields are nested in others: a field
 * found inside an embedded payload only exists once that payload is expanded,
 * so its toggle is meaningless until then.
 */
export function embeddedFields(found: readonly Embedded[]): EmbeddedField[] {
  return found.map((field) => {
    // Nearest enclosing field: the longest other pointer that prefixes this one.
    let parent: string | null = null
    for (const other of found) {
      if (!field.pointer.startsWith(other.pointer + '/')) continue
      if (parent === null || other.pointer.length > parent.length) parent = other.pointer
    }
    return { pointer: field.pointer, dotPath: field.dotPath, rawLength: field.rawLength, parent }
  })
}
