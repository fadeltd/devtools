import { describe, expect, it } from 'vitest'
import { MAX_DEPTH, parseMarkdown, safeHref, safeImageSrc } from './parse.ts'
import type { MdBlock, MdInline } from './types.ts'

const blocks = (src: string): MdBlock[] => parseMarkdown(src).blocks

/** The inline children of the first block, which must be a paragraph. */
function para(src: string): MdInline[] {
  const b = blocks(src)[0]
  if (b?.type !== 'paragraph') throw new Error(`expected a paragraph, got ${b?.type}`)
  return b.children
}

const text = (value: string): MdInline => ({ type: 'text', value })

describe('parseMarkdown: blocks', () => {
  it('is empty for empty input and for whitespace', () => {
    expect(blocks('')).toEqual([])
    expect(blocks('\n\n  \n')).toEqual([])
  })

  it('reads ATX and setext headings', () => {
    expect(blocks('# One\n\nTwo\n---\n\n###### Six')).toEqual([
      { type: 'heading', depth: 1, children: [text('One')] },
      { type: 'heading', depth: 2, children: [text('Two')] },
      { type: 'heading', depth: 6, children: [text('Six')] },
    ])
  })

  it('keeps a fenced block verbatim, with its language', () => {
    expect(blocks('```ts title="x"\nconst a = "<b>" && 1 &amp; 2\n```')).toEqual([
      { type: 'code', lang: 'ts', value: 'const a = "<b>" && 1 &amp; 2' },
    ])
    expect(blocks('    indented')).toEqual([{ type: 'code', lang: '', value: 'indented' }])
  })

  it('reads blockquotes and rules', () => {
    expect(blocks('> a\n> b\n\n---')).toEqual([
      { type: 'blockquote', children: [{ type: 'paragraph', children: [text('a\nb')] }] },
      { type: 'hr' },
    ])
  })

  it('normalises CRLF, so no \\r is left glued to a line', () => {
    expect(JSON.stringify(blocks('a\r\nb\r\n\r\n| x |\r\n|---|\r\n| 1 |\r\n'))).not.toContain('\\r')
    expect(blocks('| x |\r\n|---|\r\n| 1 |\r\n')).toEqual([
      { type: 'table', align: [null], header: [[text('x')]], rows: [[[text('1')]]] },
    ])
  })
})

describe('parseMarkdown: lists', () => {
  it('keeps a tight item unwrapped and a loose item in a paragraph', () => {
    expect(blocks('- a\n- b')).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          { task: false, checked: false, children: [{ type: 'plain', children: [text('a')] }] },
          { task: false, checked: false, children: [{ type: 'plain', children: [text('b')] }] },
        ],
      },
    ])
    const loose = blocks('1. a\n\n2. b')[0]
    expect(loose).toMatchObject({ type: 'list', ordered: true, start: 1 })
    expect(loose?.type === 'list' && loose.items[0]?.children).toEqual([{ type: 'paragraph', children: [text('a')] }])
  })

  it('keeps the number an ordered list starts at', () => {
    expect(blocks('5) five\n6) six')[0]).toMatchObject({ type: 'list', ordered: true, start: 5 })
  })

  it('reads task items without leaving the checkbox in the text', () => {
    const list = blocks('- [ ] todo\n- [x] done\n- plain')[0]
    expect(list?.type === 'list' && list.items.map((i) => [i.task, i.checked])).toEqual([
      [true, false],
      [true, true],
      [false, false],
    ])
    expect(list?.type === 'list' && list.items[1]?.children).toEqual([{ type: 'plain', children: [text('done')] }])
  })

  it('nests lists', () => {
    const list = blocks('- a\n  - b\n    1. c')[0]
    const inner = list?.type === 'list' ? list.items[0]?.children[1] : undefined
    expect(inner).toMatchObject({ type: 'list', ordered: false })
    const innermost = inner?.type === 'list' ? inner.items[0]?.children[1] : undefined
    expect(innermost).toMatchObject({ type: 'list', ordered: true })
  })
})

describe('parseMarkdown: tables', () => {
  it('reads the alignment of each column', () => {
    const t = blocks('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |')[0]
    expect(t?.type === 'table' && t.align).toEqual(['left', 'center', 'right', null])
  })

  it('keeps an escaped pipe inside its cell, in text and in code', () => {
    const t = blocks('| a\\|b | `c\\|d` |\n|---|---|\n| x | y |')[0]
    expect(t?.type === 'table' && t.header).toEqual([[text('a|b')], [{ type: 'code', value: 'c|d' }]])
  })

  it('turns <br> in a cell into a line break, and keeps links', () => {
    const t = blocks('| k | v |\n|---|---|\n| one<br>two<br/>three | [l](https://x.y/?a=1&b=2 "T") |')[0]
    expect(t?.type === 'table' && t.rows[0]).toEqual([
      [text('one'), { type: 'br' }, text('two'), { type: 'br' }, text('three')],
      [{ type: 'link', href: 'https://x.y/?a=1&b=2', title: 'T', children: [text('l')] }],
    ])
  })

  it('reads a table with a header and no rows', () => {
    expect(blocks('| a |\n|---|')).toEqual([{ type: 'table', align: [null], header: [[text('a')]], rows: [] }])
  })
})

describe('parseMarkdown: inline', () => {
  it('reads emphasis, strikethrough and code', () => {
    expect(para('**s** *e* ~~d~~ `c`')).toEqual([
      { type: 'strong', children: [text('s')] },
      text(' '),
      { type: 'em', children: [text('e')] },
      text(' '),
      { type: 'del', children: [text('d')] },
      text(' '),
      { type: 'code', value: 'c' },
    ])
  })

  it('reads both kinds of hard break', () => {
    expect(para('a  \nb\\\nc')).toEqual([text('a'), { type: 'br' }, text('b'), { type: 'br' }, text('c')])
  })

  it('decodes character references in text, once', () => {
    expect(para('a &amp; b &copy; 1 < 2 &#60; &#x3e;')).toEqual([text('a & b © 1 < 2 < >')])
    // &amp;lt; is the text "&lt;", not "<".
    expect(para('&amp;lt; &#38;lt;')).toEqual([text('&lt; &lt;')])
  })

  it('leaves code verbatim', () => {
    expect(para('`&amp; <b>`')).toEqual([{ type: 'code', value: '&amp; <b>' }])
  })

  it('drops the backslash of an escape', () => {
    expect(para('\\*not em\\* \\<b\\>')).toEqual([text('*not em* <b>')])
  })

  it('shows raw HTML as the text it is', () => {
    expect(para('a <b onclick="x()">bold</b> <img src=x onerror=alert(1)>')).toEqual([
      text('a <b onclick="x()">bold</b> <img src=x onerror=alert(1)>'),
    ])
    expect(blocks('<script>alert(1)</script>')).toEqual([{ type: 'paragraph', children: [text('<script>alert(1)</script>')] }])
    expect(blocks('<div>\n  <p>x</p>\n</div>')).toEqual([
      {
        type: 'paragraph',
        children: [text('<div>'), { type: 'br' }, text('  <p>x</p>'), { type: 'br' }, text('</div>')],
      },
    ])
  })
})

describe('parseMarkdown: links and images', () => {
  it('reads inline, reference and automatic links', () => {
    expect(para('[a](https://a.example "T") [b][r] <https://c.example> https://d.example/x_y\n\n[r]: https://b.example')).toEqual([
      { type: 'link', href: 'https://a.example', title: 'T', children: [text('a')] },
      text(' '),
      { type: 'link', href: 'https://b.example', title: null, children: [text('b')] },
      text(' '),
      { type: 'link', href: 'https://c.example', title: null, children: [text('https://c.example')] },
      text(' '),
      { type: 'link', href: 'https://d.example/x_y', title: null, children: [text('https://d.example/x_y')] },
    ])
  })

  it('resolves references in a destination, but not in an autolink', () => {
    expect(para('[a](https://x.example/?a&amp;b)')).toMatchObject([{ href: 'https://x.example/?a&b' }])
    expect(para('<https://x.example/?a&amp;b>')).toMatchObject([{ href: 'https://x.example/?a&amp;b' }])
  })

  it('keeps the text of a link it will not link', () => {
    expect(para('[js](javascript:alert(1)) [d](data:text/html,x) [rel](/path) [h](#frag)')).toEqual([text('js d rel h')])
    expect(para('[**b**](JaVaScRiPt:alert(1))')).toEqual([{ type: 'strong', children: [text('b')] }])
  })

  it('reads images, with alt text as plain text', () => {
    expect(para('![an *alt*](https://i.example/x.png "T")')).toEqual([
      { type: 'image', src: 'https://i.example/x.png', alt: 'an alt', title: 'T' },
    ])
    expect(para('![d](data:image/png;base64,AAAA)')).toEqual([
      { type: 'image', src: 'data:image/png;base64,AAAA', alt: 'd', title: null },
    ])
  })

  it('shows the alt text of an image it will not load', () => {
    expect(para('![alt](javascript:alert(1)) ![rel](x.png) ![h](data:text/html,x)')).toEqual([text('alt rel h')])
  })
})

describe('safeHref and safeImageSrc', () => {
  it('allows only the listed schemes', () => {
    expect(safeHref('https://a.example')).toBe('https://a.example')
    expect(safeHref(' HTTP://a.example ')).toBe('HTTP://a.example')
    expect(safeHref('mailto:a@b.example')).toBe('mailto:a@b.example')
    expect(safeHref('tel:+15550100')).toBe('tel:+15550100')
    for (const bad of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,x', 'vbscript:x', '//a.example', '/a', 'a', '#a', '']) {
      expect(safeHref(bad)).toBeNull()
    }
  })

  it('allows http(s) and inline image data', () => {
    expect(safeImageSrc('https://i.example/x.png')).not.toBeNull()
    expect(safeImageSrc('data:image/svg+xml;base64,AAAA')).not.toBeNull()
    for (const bad of ['data:text/html,x', 'data:image/pngx,AA', 'javascript:x', 'x.png', 'blob:https://a/b']) {
      expect(safeImageSrc(bad)).toBeNull()
    }
  })
})

function depthOf(bs: readonly MdBlock[]): number {
  return bs.reduce((d, b) => Math.max(d, b.type === 'blockquote' ? 1 + depthOf(b.children) : 1), 0)
}

describe('parseMarkdown: hostile input', () => {
  it('stops nesting at MAX_DEPTH instead of growing a tree as deep as the input', () => {
    const doc = parseMarkdown(`${'> '.repeat(MAX_DEPTH * 4)}deep`)
    expect(depthOf(doc.blocks)).toBeLessThanOrEqual(MAX_DEPTH + 2)
    expect(JSON.stringify(doc)).toContain('deep')
  })

  it('does not throw on nesting far past what the tokenizer can take', () => {
    expect(() => parseMarkdown('> '.repeat(20000) + 'x')).not.toThrow()
    expect(() => parseMarkdown('['.repeat(20000))).not.toThrow()
    // Emphasis delimiters are quadratic in the tokenizer: 50,000 take ~15 s,
    // which is why the app only ever parses in a worker it can terminate.
    expect(() => parseMarkdown('*'.repeat(3000) + 'a')).not.toThrow()
  })
})
