import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toHtml } from './html.ts'
import { parseMarkdown } from './parse.ts'

const html = (src: string): string => toHtml(parseMarkdown(src))

/** Every tag `toHtml` may write. */
const TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'strong', 'em', 'del', 'a', 'img', 'br',
])
const ATTRS = new Set(['href', 'title', 'src', 'alt', 'style', 'start'])

/**
 * Walk the output as a browser's tokenizer would see it: text and quoted
 * attribute values hold no bare `<`, `>` or `"`, so a tag is exactly `<…>`.
 */
function audit(out: string): { tags: string[]; attrs: string[]; schemes: string[] } {
  const tags: string[] = []
  const attrs: string[] = []
  const schemes: string[] = []
  for (const m of out.matchAll(/<(\/?)([^\s>]*)((?:\s+[^\s=>]+="[^"]*")*)\s*>/g)) {
    tags.push(m[2]!)
    for (const a of m[3]!.matchAll(/\s+([^\s=>]+)="([^"]*)"/g)) {
      attrs.push(a[1]!)
      if (a[1] === 'href' || a[1] === 'src') schemes.push(a[2]!.split(':')[0]!.toLowerCase())
    }
  }
  // Anything the pattern above did not consume must hold no `<` at all.
  const rest = out.replace(/<(\/?)([^\s>]*)((?:\s+[^\s=>]+="[^"]*")*)\s*>/g, '')
  if (rest.includes('<') || rest.includes('>')) throw new Error(`stray angle bracket in: ${rest.slice(0, 200)}`)
  return { tags, attrs, schemes }
}

describe('toHtml', () => {
  it('is empty for an empty document', () => {
    expect(html('')).toBe('')
  })

  it('writes the usual blocks', () => {
    expect(html('# T\n\npara *e* **s** ~~d~~\n\n> q\n\n---')).toBe(
      '<h1>T</h1>\n<p>para <em>e</em> <strong>s</strong> <del>d</del></p>\n<blockquote><p>q</p></blockquote>\n<hr>',
    )
  })

  it('writes a table with borders and the alignment of each column', () => {
    const out = html('| a | b |\n|:--|--:|\n| 1 | 2 |')
    expect(out).toContain('<table style="border-collapse:collapse"><thead><tr><th style="border:1px solid #d0d7de;padding:4px 8px;font-weight:600;text-align:left">a</th>')
    expect(out).toContain('<td style="border:1px solid #d0d7de;padding:4px 8px;text-align:right">2</td>')
    expect(out.endsWith('</tbody></table>')).toBe(true)
  })

  it('keeps escaped pipes, line breaks and links inside cells', () => {
    const out = html('| k | v |\n|---|---|\n| a\\|b | one<br>two [l](https://x.example) |')
    expect(out).toContain('>a|b</td>')
    expect(out).toContain('>one<br>two <a href="https://x.example">l</a></td>')
  })

  it('marks code as monospace, inline and in a block', () => {
    expect(html('`a < b`')).toBe(
      '<p><code style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">a &lt; b</code></p>',
    )
    expect(html('```\n<b>&amp;\n```')).toBe(
      '<pre style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"><code>&lt;b&gt;&amp;amp;</code></pre>',
    )
  })

  it('writes lists, the start number, and task marks on the first line', () => {
    expect(html('- a\n- b')).toBe('<ul><li>a</li>\n<li>b</li></ul>')
    expect(html('3. a')).toBe('<ol start="3"><li>a</li></ol>')
    expect(html('- [ ] todo\n- [x] done')).toBe('<ul><li>☐ todo</li>\n<li>☑ done</li></ul>')
    expect(html('- [x] loose\n\n- [ ] too')).toBe('<ul><li><p>☑ loose</p></li>\n<li><p>☐ too</p></li></ul>')
  })

  it('escapes raw HTML instead of emitting it', () => {
    expect(html('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(html('a <img src=x onerror=alert(1)> b')).toBe('<p>a &lt;img src=x onerror=alert(1)&gt; b</p>')
    expect(html('&lt;script&gt;')).toBe('<p>&lt;script&gt;</p>')
  })

  it('drops a link it will not link, and keeps its text', () => {
    expect(html('[x](javascript:alert(1))')).toBe('<p>x</p>')
  })

  it('escapes quotes and ampersands in attributes', () => {
    expect(html('[a](https://x.example/?a=1&b=2 "say \\"hi\\" <now>")')).toBe(
      '<p><a href="https://x.example/?a=1&amp;b=2" title="say &quot;hi&quot; &lt;now&gt;">a</a></p>',
    )
    expect(html('![a "q" <b>](https://i.example/x.png)')).toBe(
      '<p><img src="https://i.example/x.png" alt="a &quot;q&quot; &lt;b&gt;"></p>',
    )
    expect(html('[a](<https://x.example/"onmouseover="alert(1)>)')).not.toMatch(/"\s*onmouseover=/)
  })
})

describe('toHtml: properties', () => {
  // Markdown-shaped noise finds more structure than uniformly random text.
  const fragment = fc.constantFrom(
    '# ', '> ', '- ', '1. ', '- [x] ', '| ', ' | ', '|---|', '\n', '\n\n', '```', '`', '*', '**', '~~', '_',
    '[', ']', '(', ')', '<', '>', '"', "'", '&', '&amp;', '&lt;', '&#60;', '\\', '!', ':', '/',
    'javascript:', 'data:text/html,', 'https://a.example', 'http://', '<script>', '</script>', '<br>',
    '<img src=x onerror=alert(1)>', '<a href="javascript:x">', 'onclick="x"', ' ', 'text', 'a', '=',
  )
  const noisy = fc.array(fc.oneof(fragment, fc.string({ maxLength: 6 })), { maxLength: 40 }).map((a) => a.join(''))

  it('has an audit that sees what it is there to catch', () => {
    expect(audit('<p>a</p><script>x</script>').tags).toContain('script')
    expect(audit('<p onclick="x">a</p>').attrs).toContain('onclick')
    expect(audit('<a href="JavaScript:x">a</a>').schemes).toEqual(['javascript'])
    expect(() => audit('<p>a < b</p>')).toThrow()
    expect(() => audit('<p>a</p><img src=x onerror=alert(1)>')).toThrow()
  })

  it('never throws, and writes only its own tags, attributes and schemes', () => {
    fc.assert(
      fc.property(fc.oneof(noisy, fc.string()), (src) => {
        const { tags, attrs, schemes } = audit(html(src))
        for (const t of tags) expect(TAGS.has(t)).toBe(true)
        for (const a of attrs) expect(ATTRS.has(a)).toBe(true)
        for (const s of schemes) expect(['http', 'https', 'mailto', 'tel', 'data']).toContain(s)
      }),
      { numRuns: 2000 },
    )
  })
})
