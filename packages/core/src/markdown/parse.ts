import { Lexer, type Token, type Tokens } from 'marked'
import { decodeEntities } from '../html-text/entities.ts'
import type { MdAlign, MdBlock, MdDoc, MdInline, MdListItem } from './types.ts'

/**
 * Past this depth a block is kept as its source text. Renderers recurse, so a
 * paste of ten thousand nested `>` must not become ten thousand stack frames.
 */
export const MAX_DEPTH = 48

const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:)/i

/**
 * The link schemes a rendered document may carry. Everything else comes back
 * null: `javascript:` and `data:` because they run or smuggle content, and
 * relative paths because they would resolve against whatever page shows the
 * document, not the one the author meant.
 */
export function safeHref(href: string): string | null {
  const h = href.trim()
  return SAFE_HREF.test(h) ? h : null
}

const SAFE_IMAGE = /^(?:https?:\/\/|data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)[;,])/i

/** `http(s)` and inline `data:image/…` only. An `<img>` runs no script in either. */
export function safeImageSrc(src: string): string | null {
  const s = src.trim()
  return SAFE_IMAGE.test(s) ? s : null
}

const BR_TAG = /^<br\s*\/?>$/i

function pushText(out: MdInline[], value: string): void {
  if (value === '') return
  const last = out.at(-1)
  if (last?.type === 'text') last.value += value
  else out.push({ type: 'text', value })
}

/** The words of an inline run with the markup dropped: an image's alt text. */
function plainText(nodes: readonly MdInline[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'code':
        out += n.value
        break
      case 'image':
        out += n.alt
        break
      case 'br':
        out += ' '
        break
      default:
        out += plainText(n.children)
    }
  }
  return out
}

function inlines(tokens: readonly Token[] | undefined, depth: number): MdInline[] {
  const out: MdInline[] = []
  if (tokens === undefined) return out
  for (const raw of tokens) {
    if (depth > MAX_DEPTH) {
      pushText(out, raw.raw)
      continue
    }
    const t = raw as Tokens.Generic
    switch (t.type) {
      case 'text': {
        const tok = t as Tokens.Text
        if (tok.tokens !== undefined) {
          for (const n of inlines(tok.tokens, depth + 1)) {
            if (n.type === 'text') pushText(out, n.value)
            else out.push(n)
          }
        } else {
          // marked leaves named references in place for its HTML renderer to
          // pass through; `escaped` marks text it took verbatim from raw HTML.
          pushText(out, tok.escaped === true ? tok.text : decodeEntities(tok.text))
        }
        break
      }
      case 'escape':
        pushText(out, (t as Tokens.Escape).text)
        break
      case 'html': {
        // Raw HTML is never rendered: it is shown as the text it is. The one
        // exception is <br>, the only way to break a line inside a table cell.
        const text = (t as Tokens.Tag).text
        if (BR_TAG.test(text.trim())) out.push({ type: 'br' })
        else pushText(out, text)
        break
      }
      case 'br':
        out.push({ type: 'br' })
        break
      case 'codespan':
        out.push({ type: 'code', value: (t as Tokens.Codespan).text })
        break
      case 'strong':
      case 'em':
      case 'del':
        out.push({ type: t.type, children: inlines(t.tokens, depth + 1) })
        break
      case 'link': {
        const tok = t as Tokens.Link
        const children = inlines(tok.tokens, depth + 1)
        // An autolink's destination is literal; any other has references to resolve.
        const href = safeHref(tok.autolink === true ? tok.href : decodeEntities(tok.href))
        if (href === null) {
          for (const n of children) {
            if (n.type === 'text') pushText(out, n.value)
            else out.push(n)
          }
        } else {
          const title = tok.title == null || tok.title === '' ? null : decodeEntities(tok.title)
          out.push({ type: 'link', href, title, children })
        }
        break
      }
      case 'image': {
        const tok = t as Tokens.Image
        const alt = plainText(inlines(tok.tokens, depth + 1))
        const src = safeImageSrc(decodeEntities(tok.href))
        if (src === null) pushText(out, alt)
        else out.push({ type: 'image', src, alt, title: tok.title == null || tok.title === '' ? null : decodeEntities(tok.title) })
        break
      }
      case 'checkbox':
        // Carried by the list item's `task` and `checked`.
        break
      default:
        pushText(out, t.raw)
    }
  }
  return out
}

/** Text with its line breaks kept: a raw HTML block, shown as written. */
function literalLines(text: string): MdInline[] {
  const out: MdInline[] = []
  const lines = text.replace(/\n+$/, '').split('\n')
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'br' })
    pushText(out, line)
  })
  return out
}

function listItem(item: Tokens.ListItem, depth: number): MdListItem {
  return { task: item.task, checked: item.checked === true, children: blocks(item.tokens, depth + 1) }
}

function clampDepth(depth: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.min(6, Math.max(1, Math.trunc(depth))) as 1 | 2 | 3 | 4 | 5 | 6
}

function blocks(tokens: readonly Token[] | undefined, depth: number): MdBlock[] {
  const out: MdBlock[] = []
  if (tokens === undefined) return out
  for (const raw of tokens) {
    const t = raw as Tokens.Generic
    if (t.type === 'space' || t.type === 'def' || t.type === 'checkbox') continue
    if (depth > MAX_DEPTH) {
      const children = literalLines(t.raw)
      if (children.length > 0) out.push({ type: 'paragraph', children })
      continue
    }
    switch (t.type) {
      case 'heading':
        out.push({ type: 'heading', depth: clampDepth((t as Tokens.Heading).depth), children: inlines(t.tokens, depth + 1) })
        break
      case 'paragraph':
        out.push({ type: 'paragraph', children: inlines(t.tokens, depth + 1) })
        break
      case 'text': {
        // A block-level text token is the body of a tight list item.
        const tok = t as Tokens.Text
        const children = tok.tokens === undefined ? inlines([tok], depth + 1) : inlines(tok.tokens, depth + 1)
        const last = out.at(-1)
        if (last?.type === 'plain') last.children.push({ type: 'text', value: '\n' }, ...children)
        else out.push({ type: 'plain', children })
        break
      }
      case 'blockquote':
        out.push({ type: 'blockquote', children: blocks(t.tokens, depth + 1) })
        break
      case 'list': {
        const tok = t as Tokens.List
        out.push({
          type: 'list',
          ordered: tok.ordered,
          start: typeof tok.start === 'number' ? tok.start : 1,
          items: tok.items.map((item) => listItem(item, depth)),
        })
        break
      }
      case 'code': {
        const tok = t as Tokens.Code
        out.push({ type: 'code', lang: (tok.lang ?? '').trim().split(/\s+/)[0] ?? '', value: tok.text })
        break
      }
      case 'table': {
        const tok = t as Tokens.Table
        const cell = (c: Tokens.TableCell) => inlines(c.tokens, depth + 1)
        out.push({
          type: 'table',
          align: tok.align.map((a): MdAlign => a),
          header: tok.header.map(cell),
          rows: tok.rows.map((r) => r.map(cell)),
        })
        break
      }
      case 'hr':
        out.push({ type: 'hr' })
        break
      case 'html': {
        const children = literalLines((t as Tokens.HTML).text)
        if (children.length > 0) out.push({ type: 'paragraph', children })
        break
      }
      default: {
        const children = literalLines(t.raw)
        if (children.length > 0) out.push({ type: 'paragraph', children })
      }
    }
  }
  return out
}

/**
 * Parse GitHub-flavoured Markdown into a tree. Never throws: input the
 * tokenizer gives up on (pathological nesting) comes back as one code block
 * holding the source, which is at least what was pasted.
 *
 * Raw HTML is not interpreted. Tags come back as the text they are, except
 * `<br>`, which is a line break. Footnotes are not supported.
 */
export function parseMarkdown(src: string): MdDoc {
  if (src === '') return { blocks: [] }
  try {
    return { blocks: blocks(Lexer.lex(src, { gfm: true }), 0) }
  } catch {
    return { blocks: [{ type: 'code', lang: '', value: src }] }
  }
}
