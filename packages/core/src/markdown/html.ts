import { escapeHtml } from '../escape/html.ts'
import type { MdAlign, MdBlock, MdDoc, MdInline, MdListItem } from './types.ts'

// Inline styles, because a paste target keeps no stylesheet. Slack reads the
// tags alone; Google Docs and Gmail need the borders and the font spelled out.
const MONO = 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
const CELL = 'border:1px solid #d0d7de;padding:4px 8px'
const HEAD_CELL = `${CELL};font-weight:600`

/** What a task-list item starts with. Characters, because a paste target drops `<input>`. */
export const TASK_OPEN = '☐ '
export const TASK_DONE = '☑ '

function inline(nodes: readonly MdInline[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += escapeHtml(n.value)
        break
      case 'strong':
        out += `<strong>${inline(n.children)}</strong>`
        break
      case 'em':
        out += `<em>${inline(n.children)}</em>`
        break
      case 'del':
        out += `<del>${inline(n.children)}</del>`
        break
      case 'code':
        out += `<code style="${MONO}">${escapeHtml(n.value)}</code>`
        break
      case 'link':
        out +=
          `<a href="${escapeHtml(n.href)}"` +
          (n.title === null ? '' : ` title="${escapeHtml(n.title)}"`) +
          `>${inline(n.children)}</a>`
        break
      case 'image':
        out +=
          `<img src="${escapeHtml(n.src)}" alt="${escapeHtml(n.alt)}"` +
          (n.title === null ? '' : ` title="${escapeHtml(n.title)}"`) +
          '>'
        break
      case 'br':
        out += '<br>'
        break
    }
  }
  return out
}

function cellStyle(base: string, align: MdAlign): string {
  return align === null ? base : `${base};text-align:${align}`
}

function row(tag: 'th' | 'td', cells: readonly (readonly MdInline[])[], align: readonly MdAlign[], columns: number): string {
  const base = tag === 'th' ? HEAD_CELL : CELL
  let out = '<tr>'
  for (let c = 0; c < columns; c++) {
    out += `<${tag} style="${cellStyle(base, align[c] ?? null)}">${inline(cells[c] ?? [])}</${tag}>`
  }
  return out + '</tr>'
}

function item(it: MdListItem): string {
  const mark = it.task ? (it.checked ? TASK_DONE : TASK_OPEN) : ''
  const [first, ...rest] = it.children
  // The mark belongs on the first line of the item, so it goes inside the
  // paragraph that opens it rather than in front of it.
  if (mark !== '' && first !== undefined && (first.type === 'paragraph' || first.type === 'plain')) {
    const head = first.type === 'paragraph' ? `<p>${mark}${inline(first.children)}</p>` : mark + inline(first.children)
    return `<li>${[head, ...rest.map(block)].join('\n')}</li>`
  }
  return `<li>${mark}${it.children.map(block).join('\n')}</li>`
}

function block(b: MdBlock): string {
  switch (b.type) {
    case 'heading':
      return `<h${b.depth}>${inline(b.children)}</h${b.depth}>`
    case 'paragraph':
      return `<p>${inline(b.children)}</p>`
    case 'plain':
      return inline(b.children)
    case 'blockquote':
      return `<blockquote>${b.children.map(block).join('\n')}</blockquote>`
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul'
      const open = b.ordered && b.start !== 1 ? `<ol start="${b.start}">` : `<${tag}>`
      return `${open}${b.items.map(item).join('\n')}</${tag}>`
    }
    case 'code':
      return `<pre style="${MONO}"><code>${escapeHtml(b.value)}</code></pre>`
    case 'table': {
      const columns = Math.max(b.header.length, ...b.rows.map((r) => r.length))
      if (columns === 0) return ''
      const head = b.header.length === 0 ? '' : `<thead>${row('th', b.header, b.align, columns)}</thead>`
      const body = b.rows.length === 0 ? '' : `<tbody>${b.rows.map((r) => row('td', r, b.align, columns)).join('\n')}</tbody>`
      return `<table style="border-collapse:collapse">${head}${body}</table>`
    }
    case 'hr':
      return '<hr>'
  }
}

/**
 * Serialise a tree to HTML for the clipboard, so a paste into Slack, Google
 * Docs or Gmail keeps tables and formatting. Every string from the document
 * is escaped, in text and in attributes, and the tag set is fixed: the output
 * cannot carry markup the tree did not spell out as a node.
 */
export function toHtml(doc: MdDoc): string {
  return doc.blocks.map(block).filter((s) => s !== '').join('\n')
}
