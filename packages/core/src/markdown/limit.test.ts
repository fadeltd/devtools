import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toHtml } from './html.ts'
import { limitDoc } from './limit.ts'
import { parseMarkdown } from './parse.ts'
import type { MdBlock, MdInline } from './types.ts'

function countInline(nodes: readonly MdInline[]): number {
  return nodes.reduce((n, x) => n + 1 + ('children' in x ? countInline(x.children) : 0), 0)
}

function count(blocks: readonly MdBlock[]): number {
  let n = 0
  for (const b of blocks) {
    n++
    switch (b.type) {
      case 'heading':
      case 'paragraph':
      case 'plain':
        n += countInline(b.children)
        break
      case 'blockquote':
        n += count(b.children)
        break
      case 'list':
        for (const item of b.items) n += 1 + count(item.children)
        break
      case 'table':
        for (const c of b.header) n += countInline(c)
        for (const r of b.rows) n += 1 + r.reduce((s, c) => s + countInline(c), 0)
        break
      default:
    }
  }
  return n
}

describe('limitDoc', () => {
  it('returns the same document when it fits', () => {
    const doc = parseMarkdown('# T\n\n- a\n- b\n\n| x |\n|---|\n| 1 |')
    const out = limitDoc(doc, 1000)
    expect(out.truncated).toBe(false)
    expect(out.doc).toBe(doc)
  })

  it('drops the blocks past the budget', () => {
    const doc = parseMarkdown(Array.from({ length: 500 }, (_, i) => `p${i}`).join('\n\n'))
    const out = limitDoc(doc, 100)
    expect(out.truncated).toBe(true)
    // A paragraph and its text cost 2.
    expect(out.doc.blocks).toHaveLength(50)
    expect(out.doc.blocks[0]).toEqual(doc.blocks[0])
  })

  it('cuts inside one long list', () => {
    const doc = parseMarkdown(Array.from({ length: 5000 }, (_, i) => `- item ${i}`).join('\n'))
    const out = limitDoc(doc, 300)
    const list = out.doc.blocks[0]
    expect(out.truncated).toBe(true)
    expect(out.doc.blocks).toHaveLength(1)
    expect(list?.type === 'list' && list.items.length).toBeGreaterThan(50)
    expect(list?.type === 'list' && list.items.length).toBeLessThan(300)
  })

  it('cuts inside one long table, keeping the header', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `| ${i} | x |`).join('\n')
    const out = limitDoc(parseMarkdown(`| a | b |\n|---|---|\n${rows}`), 300)
    const table = out.doc.blocks[0]
    expect(out.truncated).toBe(true)
    expect(table?.type === 'table' && table.header).toHaveLength(2)
    expect(table?.type === 'table' && table.rows.length).toBeGreaterThan(50)
    expect(table?.type === 'table' && table.rows.length).toBeLessThan(300)
  })

  it('cuts one huge run of text, and not through a surrogate pair', () => {
    const out = limitDoc(parseMarkdown('```\n' + '😀'.repeat(100_000) + '\n```'), 10)
    const code = out.doc.blocks[0]
    expect(out.truncated).toBe(true)
    const value = code?.type === 'code' ? code.value : ''
    expect(value.length).toBeLessThanOrEqual(10 * 80)
    expect(value.length).toBeGreaterThan(0)
    // Whole emoji only: an odd length would mean a pair was split.
    expect(value.length % 2).toBe(0)
    expect(value.replaceAll('😀', '')).toBe('')
  })

  it('cuts inside one paragraph of many inline nodes', () => {
    const out = limitDoc(parseMarkdown(Array.from({ length: 5000 }, (_, i) => `line ${i} *em*`).join('\n')), 200)
    const p = out.doc.blocks[0]
    expect(out.truncated).toBe(true)
    expect(p?.type === 'paragraph' && p.children.length).toBeLessThan(200)
  })

  it('does not change the document it was given', () => {
    const doc = parseMarkdown(Array.from({ length: 200 }, (_, i) => `- item ${i}`).join('\n'))
    const before = JSON.stringify(doc)
    limitDoc(doc, 20)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('never returns more nodes than the budget, and still serialises', () => {
    const line = fc.constantFrom('# h', '- a', '  - b', '1. c', '> q', '| a | b |', '|---|---|', '', 'text *e* `c`', '```', '- [x] t')
    fc.assert(
      fc.property(fc.array(line, { maxLength: 60 }), fc.integer({ min: 0, max: 80 }), (lines, budget) => {
        const out = limitDoc(parseMarkdown(lines.join('\n')), budget)
        // Table header cells are kept whole, so allow for one header.
        if (out.truncated) expect(count(out.doc.blocks)).toBeLessThanOrEqual(budget + 8)
        expect(() => toHtml(out.doc)).not.toThrow()
      }),
      { numRuns: 500 },
    )
  })
})
