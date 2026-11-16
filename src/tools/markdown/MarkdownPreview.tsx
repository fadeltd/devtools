import { memo, type ReactNode } from 'react'
import { ImageOff } from 'lucide-react'
import {
  TASK_DONE,
  TASK_OPEN,
  type MdAlign,
  type MdBlock,
  type MdDoc,
  type MdInline,
  type MdListItem,
} from '@fadeltd/devtools-core/markdown'
import { cn } from '@/lib/util/cn'

// The tree becomes React elements, never an HTML string: text reaches the DOM
// as text nodes, so nothing a document says can become markup.

// A node's position is its identity here: each render draws a whole new tree
// from the worker, and nothing in one is ever reordered.
/* oxlint-disable react/no-array-index-key */

const HEADING = [
  'mt-5 text-[20px] leading-7 font-semibold first:mt-0',
  'mt-5 border-b border-border pb-1 text-[17px] leading-6 font-semibold first:mt-0',
  'mt-4 text-[15px] leading-5.5 font-semibold first:mt-0',
  'mt-4 text-[13px] font-semibold first:mt-0',
  'mt-4 text-[13px] font-semibold text-muted first:mt-0',
  'mt-4 text-[12px] font-semibold text-muted first:mt-0',
] as const

const ALIGN: Record<Exclude<MdAlign, null>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

const CODE = 'rounded-[4px] border border-border bg-surface px-1 py-px font-mono text-[12px]'

function inline(nodes: readonly MdInline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return n.value
      case 'strong':
        return <strong key={i} className="font-semibold">{inline(n.children)}</strong>
      case 'em':
        return <em key={i}>{inline(n.children)}</em>
      case 'del':
        return <del key={i} className="text-muted">{inline(n.children)}</del>
      case 'code':
        return <code key={i} className={CODE}>{n.value}</code>
      case 'link':
        // Underlined rather than accent-coloured: the accent means focus here.
        return (
          <a
            key={i}
            href={n.href}
            title={n.title ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-border-strong underline-offset-2 hover:decoration-fg"
          >
            {inline(n.children)}
          </a>
        )
      case 'image':
        return <Image key={i} src={n.src} alt={n.alt} title={n.title} />
      case 'br':
        return <br key={i} />
    }
  })
}

function Image({ src, alt, title }: { src: string; alt: string; title: string | null }) {
  if (/^data:/i.test(src)) {
    return <img src={src} alt={alt} title={title ?? undefined} className="inline-block max-w-full align-middle" />
  }
  // The CSP would block it anyway. Saying so beats a broken-image icon.
  return (
    <span
      title={`Not loaded: this site makes no network requests. The copied HTML still points at ${src}`}
      className="inline-flex max-w-full items-center gap-1 rounded-[4px] border border-border px-1 align-middle text-[12px] text-muted"
    >
      <ImageOff size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{alt === '' ? src : alt}</span>
    </span>
  )
}

function item(it: MdListItem, key: number): ReactNode {
  const mark = it.task ? (it.checked ? TASK_DONE : TASK_OPEN) : null
  const [first, ...rest] = it.children
  let body: ReactNode
  if (mark !== null && first !== undefined && (first.type === 'paragraph' || first.type === 'plain')) {
    // The mark sits on the item's first line, inside the paragraph that opens it.
    const head =
      first.type === 'paragraph' ? (
        <p key="head">
          {mark}
          {inline(first.children)}
        </p>
      ) : (
        [mark, ...inline(first.children)]
      )
    body = [head, ...blocks(rest, 1)]
  } else {
    body = [mark, ...blocks(it.children, 0)]
  }
  return (
    <li key={key} className={cn('space-y-2', it.task && 'list-none -ml-4')}>
      {body}
    </li>
  )
}

function cells(tag: 'th' | 'td', row: readonly (readonly MdInline[])[], align: readonly MdAlign[], columns: number): ReactNode[] {
  const Tag = tag
  return Array.from({ length: columns }, (_, c) => {
    const a = align[c] ?? null
    return (
      <Tag
        key={c}
        className={cn(
          'border border-border px-2 py-1 align-top',
          tag === 'th' && 'bg-surface font-semibold',
          a === null ? 'text-left' : ALIGN[a],
        )}
      >
        {inline(row[c] ?? [])}
      </Tag>
    )
  })
}

function blocks(list: readonly MdBlock[], keyOffset: number): ReactNode[] {
  return list.map((b, index) => {
    const i = index + keyOffset
    switch (b.type) {
      case 'heading': {
        const Tag = `h${b.depth}` as const
        return <Tag key={i} className={HEADING[b.depth - 1]}>{inline(b.children)}</Tag>
      }
      case 'paragraph':
        return <p key={i}>{inline(b.children)}</p>
      case 'plain':
        return <span key={i}>{inline(b.children)}</span>
      case 'blockquote':
        return (
          <blockquote key={i} className="space-y-3 border-l-2 border-border-strong pl-3 text-muted">
            {blocks(b.children, 0)}
          </blockquote>
        )
      case 'list':
        return b.ordered ? (
          <ol key={i} start={b.start} className="list-decimal space-y-1 pl-6">
            {b.items.map(item)}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-6">
            {b.items.map(item)}
          </ul>
        )
      case 'code':
        // One text node, not a span per token: this is not a highlighter.
        return (
          <pre
            key={i}
            className="overflow-x-auto rounded-[4px] border border-border bg-surface p-3 font-mono text-[12px] leading-4.5 scroll-thin"
          >
            <code>{b.value}</code>
          </pre>
        )
      case 'table': {
        const columns = Math.max(b.header.length, ...b.rows.map((r) => r.length))
        if (columns === 0) return null
        return (
          // Sharp corners: a grid aligns to the hairlines, it does not float.
          <div key={i} className="overflow-x-auto scroll-thin">
            <table className="border-collapse text-[13px]">
              {b.header.length > 0 && (
                <thead>
                  <tr>{cells('th', b.header, b.align, columns)}</tr>
                </thead>
              )}
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>{cells('td', r, b.align, columns)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      case 'hr':
        return <hr key={i} className="border-border" />
    }
  })
}

/**
 * Memoised on the document: the worker hands over a new tree only when the
 * source changed, so typing in an unrelated control redraws nothing here.
 */
export const MarkdownPreview = memo(function MarkdownPreview({ doc }: { doc: MdDoc }) {
  return (
    <article className="max-w-[88ch] space-y-3 font-sans text-[13px] leading-5 wrap-break-word text-fg">
      {blocks(doc.blocks, 0)}
    </article>
  )
})
