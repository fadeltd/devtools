import type { MdBlock, MdDoc, MdInline, MdListItem } from './types.ts'

/** A run of text costs one unit per this many characters, about a line. */
const CHARS_PER_UNIT = 80

interface Budget {
  left: number
  truncated: boolean
}

function spend(b: Budget, chars = 0): boolean {
  if (b.left <= 0) {
    b.truncated = true
    return false
  }
  b.left -= 1 + Math.floor(chars / CHARS_PER_UNIT)
  return true
}

/** Cut a string to what the budget still covers. */
function text(b: Budget, value: string): string | null {
  if (b.left <= 0) {
    b.truncated = true
    return null
  }
  const room = b.left * CHARS_PER_UNIT
  b.left -= 1 + Math.floor(value.length / CHARS_PER_UNIT)
  if (value.length <= room) return value
  b.truncated = true
  // Not through the middle of a surrogate pair.
  const end = value.charCodeAt(room - 1) >= 0xd800 && value.charCodeAt(room - 1) <= 0xdbff ? room - 1 : room
  return value.slice(0, end)
}

function inlines(nodes: readonly MdInline[], b: Budget): MdInline[] {
  const out: MdInline[] = []
  for (const n of nodes) {
    if (b.left <= 0) {
      b.truncated = true
      break
    }
    switch (n.type) {
      case 'text':
      case 'code': {
        const value = text(b, n.value)
        if (value !== null) out.push({ type: n.type, value })
        break
      }
      case 'br':
      case 'image':
        if (spend(b)) out.push(n)
        break
      case 'link':
        if (spend(b)) out.push({ ...n, children: inlines(n.children, b) })
        break
      default:
        if (spend(b)) out.push({ type: n.type, children: inlines(n.children, b) })
    }
  }
  return out
}

function items(list: readonly MdListItem[], b: Budget): MdListItem[] {
  const out: MdListItem[] = []
  for (const it of list) {
    if (!spend(b)) break
    out.push({ task: it.task, checked: it.checked, children: blocks(it.children, b) })
  }
  return out
}

function blocks(list: readonly MdBlock[], b: Budget): MdBlock[] {
  const out: MdBlock[] = []
  for (const n of list) {
    if (!spend(b)) break
    switch (n.type) {
      case 'heading':
        out.push({ type: 'heading', depth: n.depth, children: inlines(n.children, b) })
        break
      case 'paragraph':
      case 'plain':
        out.push({ type: n.type, children: inlines(n.children, b) })
        break
      case 'blockquote':
        out.push({ type: 'blockquote', children: blocks(n.children, b) })
        break
      case 'list':
        out.push({ type: 'list', ordered: n.ordered, start: n.start, items: items(n.items, b) })
        break
      case 'code':
        out.push({ type: 'code', lang: n.lang, value: text(b, n.value) ?? '' })
        break
      case 'table': {
        const header = n.header.map((c) => inlines(c, b))
        const rows: MdInline[][][] = []
        for (const r of n.rows) {
          if (!spend(b)) break
          rows.push(r.map((c) => inlines(c, b)))
        }
        out.push({ type: 'table', align: n.align, header, rows })
        break
      }
      case 'hr':
        out.push(n)
        break
    }
  }
  return out
}

export interface LimitedDoc {
  doc: MdDoc
  /** True when anything was left out. */
  truncated: boolean
}

/**
 * The start of a document, cut to a budget of nodes, for a renderer that
 * builds real DOM. Blocks are not the unit: one list can hold 100,000 items
 * and one table 20,000 rows, so the cut can fall inside a block, which then
 * keeps the items, rows or text that fit. A node costs 1, plus 1 for every 80
 * characters of text it holds.
 */
export function limitDoc(doc: MdDoc, budget: number): LimitedDoc {
  const b: Budget = { left: budget, truncated: false }
  const out = blocks(doc.blocks, b)
  return { doc: b.truncated ? { blocks: out } : doc, truncated: b.truncated }
}
