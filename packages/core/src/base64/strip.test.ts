import { describe, expect, it } from 'vitest'
import { standaloneSvg, summarizeRemovals, type Removal } from './strip.ts'
import { svgRoot } from './svg.ts'

describe('summarizeRemovals', () => {
  it('says so when nothing was removed', () => {
    const report = summarizeRemovals([])
    expect(report).toEqual({ total: 0, dangerous: 0, items: [], summary: 'Nothing to strip' })
  })

  it('groups handlers, counts script URLs and puts the dangerous ones first', () => {
    const removed: Removal[] = [
      { kind: 'element', name: '#comment' },
      { kind: 'attribute', name: 'onload', element: 'svg' },
      { kind: 'element', name: 'script' },
      { kind: 'attribute', name: 'onclick', element: 'rect' },
      { kind: 'attribute', name: 'xlink:href', element: 'a', value: 'javascript:alert(1)' },
      { kind: 'element', name: 'foreignObject' },
    ]
    const report = summarizeRemovals(removed)
    expect(report.total).toBe(6)
    expect(report.dangerous).toBe(5)
    expect(report.summary).toBe('Stripped 1 <script>, 2 on* handlers, 1 javascript: URL, 1 <foreignObject>, 1 comment')
    const handlers = report.items.find((i) => i.category === 'handler')
    expect(handlers?.names).toEqual(['onload', 'onclick'])
    expect(report.items.at(-1)).toMatchObject({ category: 'node', dangerous: false, text: '1 comment' })
  })

  it('sees through whitespace and control characters in a URL scheme', () => {
    const report = summarizeRemovals([
      { kind: 'attribute', name: 'href', element: 'a', value: ' \tjava\nscript:alert(1)' },
      { kind: 'attribute', name: 'HREF', element: 'a', value: 'JavaScript:void(0)' },
    ])
    expect(report.items).toHaveLength(1)
    expect(report.items[0]).toMatchObject({ category: 'script-url', count: 2, text: '2 javascript: URLs' })
  })

  it('tells data: and other URLs apart from script URLs, and without a value says only "disallowed"', () => {
    const report = summarizeRemovals([
      { kind: 'attribute', name: 'href', element: 'use', value: 'data:image/svg+xml;base64,AAAA' },
      { kind: 'attribute', name: 'href', element: 'use' },
      { kind: 'attribute', name: 'src', element: 'image', value: 'https://example.com/x.png' },
    ])
    expect(report.dangerous).toBe(0)
    expect(report.summary).toBe('Stripped 2 disallowed URLs, 1 data: URL')
  })

  it('names other elements and attributes as they are, case-insensitively grouped', () => {
    const report = summarizeRemovals([
      { kind: 'element', name: 'iframe' },
      { kind: 'element', name: 'blink' },
      { kind: 'element', name: 'BLINK' },
      { kind: 'attribute', name: 'formaction', element: 'button', value: 'x' },
      { kind: 'attribute', name: 'ping', element: 'a', value: 'x' },
    ])
    expect(report.items.map((i) => i.text)).toEqual(['1 <iframe>', '2 <blink>', '1 disallowed URL', '1 ping attribute'])
    expect(report.items[0]?.dangerous).toBe(true)
  })

  it('counts every removal, even repeats of the same name', () => {
    const many: Removal[] = Array.from({ length: 50 }, () => ({ kind: 'element', name: 'script' }))
    expect(summarizeRemovals(many).summary).toBe('Stripped 50 <script>')
  })
})

describe('standaloneSvg', () => {
  it('adds the SVG namespace an inline <svg> leaves out', () => {
    expect(standaloneSvg('<svg width="1"><rect></rect></svg>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1"><rect></rect></svg>',
    )
  })

  it('adds xlink only when xlink attributes are used', () => {
    const out = standaloneSvg('<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#a"></use></svg>')
    expect(out).toBe(
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg"><use xlink:href="#a"></use></svg>',
    )
  })

  it('leaves complete or non-SVG markup alone', () => {
    const done = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    expect(standaloneSvg(done)).toBe(done)
    expect(standaloneSvg('')).toBe('')
  })
})

describe('svgRoot', () => {
  it('reports the raw sizing attributes', () => {
    expect(svgRoot('<svg width="100%" viewBox=" 0 0 24 24 ">')).toEqual({ width: '100%', height: null, viewBox: '0 0 24 24' })
    expect(svgRoot('<svg stroke-width="2">')).toEqual({ width: null, height: null, viewBox: null })
    expect(svgRoot('<div>')).toBeNull()
  })
})
