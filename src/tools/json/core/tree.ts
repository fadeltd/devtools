/**
 * Flatten a parsed JSON value into the rows of a collapsible tree.
 *
 * The tree view virtualises over this list, so the list only ever contains the
 * rows that are *reachable* -- a collapsed container contributes one row no
 * matter how large it is. That keeps the cost proportional to what is on
 * screen, not to the document: a 20 MB array collapsed at the root is 1 row.
 *
 * Rows are identified by their RFC 6901 pointer, which is stable across a
 * re-parse as long as the keys are, so expansion state survives an edit.
 */

import { escapePointerToken } from './embedded'
import { isRawNumber, rawNumberText } from './rawjson'

export type NodeKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export interface FlatNode {
  /** RFC 6901 pointer; '' for the root. */
  pointer: string
  depth: number
  /** Object key or array index; null for the root. */
  key: string | number | null
  kind: NodeKind
  /** Number of direct children; 0 for scalars. */
  childCount: number
  expanded: boolean
  /** Scalars rendered as JSON, capped at PREVIEW_MAX; '' for containers. */
  preview: string
  /** Row index of the parent; -1 for the root. */
  parent: number
}

/**
 * A multi-MB string would otherwise be JSON.stringify'd for its row every time
 * the list is rebuilt, and only ~100 characters of it fit on screen anyway.
 */
export const PREVIEW_MAX = 1000

export function kindOf(value: unknown): NodeKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (isRawNumber(value)) return 'number'
  switch (typeof value) {
    case 'object':
      return 'object'
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      // JSON.parse never produces anything else; treat stray values as null
      // rather than crashing the view.
      return 'null'
  }
}

function childCount(value: unknown, kind: NodeKind): number {
  if (kind === 'array') return (value as unknown[]).length
  if (kind === 'object') return Object.keys(value as object).length
  return 0
}

function preview(value: unknown, kind: NodeKind): string {
  if (kind === 'object' || kind === 'array') return ''
  if (kind === 'string') {
    const s = value as string
    if (s.length <= PREVIEW_MAX) return JSON.stringify(s)
    // Drop the closing quote, mark the cut, and close it again.
    return `${JSON.stringify(s.slice(0, PREVIEW_MAX)).slice(0, -1)}…"`
  }
  if (isRawNumber(value)) return rawNumberText(value)
  return JSON.stringify(value) ?? 'null'
}

/** Children in document order: indices for arrays, insertion order for objects. */
function children(value: unknown, kind: NodeKind): [string | number, unknown][] {
  if (kind === 'array') return (value as unknown[]).map((v, i) => [i, v])
  if (kind === 'object') return Object.entries(value as Record<string, unknown>)
  return []
}

function childPointer(parent: string, key: string | number): string {
  return `${parent}/${escapePointerToken(String(key))}`
}

interface Frame {
  value: unknown
  pointer: string
  depth: number
  key: string | number | null
  parent: number
}

/**
 * Pre-order rows for every node reachable through `expanded` containers.
 *
 * Iterative, so a deeply nested document cannot overflow the call stack.
 */
export function flattenTree(root: unknown, expanded: ReadonlySet<string>): FlatNode[] {
  const rows: FlatNode[] = []
  const stack: Frame[] = [{ value: root, pointer: '', depth: 0, key: null, parent: -1 }]

  while (stack.length > 0) {
    const frame = stack.pop()!
    const kind = kindOf(frame.value)
    const count = childCount(frame.value, kind)
    const isOpen = count > 0 && expanded.has(frame.pointer)
    const index = rows.length

    rows.push({
      pointer: frame.pointer,
      depth: frame.depth,
      key: frame.key,
      kind,
      childCount: count,
      expanded: isOpen,
      preview: preview(frame.value, kind),
      parent: frame.parent,
    })

    if (!isOpen) continue
    const entries = children(frame.value, kind)
    // Reverse so the first child is popped first.
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, value] = entries[i]!
      stack.push({
        value,
        pointer: childPointer(frame.pointer, key),
        depth: frame.depth + 1,
        key,
        parent: index,
      })
    }
  }

  return rows
}

/**
 * The key path of a row, rebuilt from its parent links. Rows do not carry one:
 * copying a path per row costs O(depth) each, and only the selected row ever
 * needs it.
 */
export function pathOf(rows: readonly FlatNode[], index: number): (string | number)[] {
  const path: (string | number)[] = []
  for (let i = index; i > 0; i = rows[i]!.parent) path.push(rows[i]!.key!)
  return path.toReversed()
}

export interface ExpandOptions {
  /** Containers shallower than this are expanded. 2 shows root + 2 levels. */
  maxDepth?: number
  /** Stop expanding once the visible row count would exceed this. */
  maxRows?: number
}

/**
 * The expansion a freshly pasted document opens with: breadth-first, so a wide
 * document shows its top level rather than drilling into its first element,
 * and capped, so a 100k-element array does not open fully expanded.
 *
 * The root is always expanded -- a single collapsed row is never useful.
 */
export function defaultExpanded(root: unknown, options: ExpandOptions = {}): Set<string> {
  const { maxDepth = 2, maxRows = 1000 } = options
  const out = new Set<string>()
  const rootKind = kindOf(root)
  if (childCount(root, rootKind) === 0) return out

  out.add('')
  let rows = 1 + childCount(root, rootKind)
  let level: { value: unknown; pointer: string }[] = [{ value: root, pointer: '' }]

  for (let depth = 1; depth < maxDepth; depth++) {
    const next: { value: unknown; pointer: string }[] = []
    for (const node of level) {
      for (const [key, value] of children(node.value, kindOf(node.value))) {
        const count = childCount(value, kindOf(value))
        if (count === 0) continue
        if (rows + count > maxRows) return out
        const pointer = childPointer(node.pointer, key)
        out.add(pointer)
        rows += count
        next.push({ value, pointer })
      }
    }
    level = next
  }
  return out
}

/**
 * Every container pointer, for "Expand all" -- capped by the number of rows the
 * result would produce, because expanding a million-node document fully would
 * allocate a million rows. `capped` says whether the limit was hit, so the UI
 * can say so instead of silently expanding only part of it.
 */
export function allContainerPointers(
  root: unknown,
  maxRows = 200_000,
): { expanded: Set<string>; capped: boolean } {
  const expanded = new Set<string>()
  let rows = 1
  const stack: { value: unknown; pointer: string }[] = [{ value: root, pointer: '' }]

  while (stack.length > 0) {
    const { value, pointer } = stack.pop()!
    const kind = kindOf(value)
    const count = childCount(value, kind)
    if (count === 0) continue
    if (rows + count > maxRows) return { expanded, capped: true }
    expanded.add(pointer)
    rows += count
    const entries = children(value, kind)
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, child] = entries[i]!
      stack.push({ value: child, pointer: childPointer(pointer, key) })
    }
  }
  return { expanded, capped: false }
}

export function toggle(expanded: ReadonlySet<string>, pointer: string): Set<string> {
  const next = new Set(expanded)
  if (next.has(pointer)) next.delete(pointer)
  else next.add(pointer)
  return next
}

/** Total node count of a value, containers and scalars alike. */
export function countNodes(root: unknown): number {
  let n = 0
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const value = stack.pop()
    n++
    const kind = kindOf(value)
    if (kind === 'array') for (const v of value as unknown[]) stack.push(v)
    else if (kind === 'object') for (const v of Object.values(value as object)) stack.push(v)
  }
  return n
}
