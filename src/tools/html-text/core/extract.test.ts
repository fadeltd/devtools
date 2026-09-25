import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { decodeEntities, htmlToText } from './extract'

describe('decodeEntities', () => {
  it('decodes common named entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;')).toBe(`a & b <c> "d" 'e'`)
  })

  it('decodes nbsp to U+00A0, not a plain space', () => {
    expect(decodeEntities('a&nbsp;b')).toBe('a\u00a0b')
  })

  it('decodes decimal and hex numeric references', () => {
    expect(decodeEntities('&#8212; &#x2014; &#X1F44D;')).toBe('— — 👍')
  })

  it('remaps 0x80..0x9F references to windows-1252, as browsers do', () => {
    expect(decodeEntities('&#150; &#147;x&#148; &#128;')).toBe('– “x” €')
  })

  it('maps invalid code points to U+FFFD instead of throwing', () => {
    expect(decodeEntities('&#0; &#xD800; &#x110000;')).toBe('� � �')
  })

  it('leaves unknown named entities untouched', () => {
    expect(decodeEntities('&bogus; &amp')).toBe('&bogus; &amp')
  })

  it('does not double-decode', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })
})

describe('htmlToText: whitespace', () => {
  it('returns empty for empty input', () => {
    expect(htmlToText('')).toBe('')
  })

  it('passes plain text through', () => {
    expect(htmlToText('hello world')).toBe('hello world')
  })

  it('collapses whitespace runs the way a browser does', () => {
    expect(htmlToText('  a \n\t b   <span> c </span>  ')).toBe('a b c')
  })

  it('does not insert spaces between adjacent inline elements', () => {
    expect(htmlToText('<b>bo</b><i>ld</i>')).toBe('bold')
  })

  it('preserves whitespace inside <pre>', () => {
    expect(htmlToText('<p>x</p><pre>  a\n    b</pre><p>y</p>')).toBe('x\n\n  a\n    b\n\ny')
  })

  it('drops the single newline directly after <pre>', () => {
    expect(htmlToText('<pre>\nline</pre>')).toBe('line')
  })

  it('turns <br> into a newline', () => {
    expect(htmlToText('a<br>b<br/>c')).toBe('a\nb\nc')
  })

  it('keeps nbsp as a real space in the output', () => {
    expect(htmlToText('a&nbsp;&nbsp;b')).toBe('a  b')
  })

  it('never emits a trailing newline or trailing spaces', () => {
    expect(htmlToText('<p>a </p>\n\n<div> b </div>\n')).toBe('a\n\nb')
  })
})

describe('htmlToText: blocks', () => {
  it('puts generic blocks on their own lines', () => {
    expect(htmlToText('<div>a</div><div>b</div>')).toBe('a\nb')
  })

  it('separates paragraphs with a blank line', () => {
    expect(htmlToText('<p>a</p><p>b</p>')).toBe('a\n\nb')
  })

  it('separates headings with a blank line', () => {
    expect(htmlToText('<h1>Title</h1>text')).toBe('Title\n\ntext')
  })

  it('never produces more than one blank line in a row', () => {
    expect(htmlToText('<p>a</p><p></p><div></div><p>b</p>')).toBe('a\n\nb')
  })

  it('is case-insensitive about tag names', () => {
    expect(htmlToText('<P>a</P><DIV>b</DIV>')).toBe('a\n\nb')
  })
})

describe('htmlToText: lists and tables', () => {
  it('bullets unordered list items', () => {
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b')
  })

  it('numbers ordered list items', () => {
    expect(htmlToText('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b')
  })

  it('respects <ol start>', () => {
    expect(htmlToText('<ol start="3"><li>a</li><li>b</li></ol>')).toBe('3. a\n4. b')
  })

  it('indents nested lists', () => {
    expect(htmlToText('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')).toBe(
      '- a\n  - b\n- c',
    )
  })

  it('handles implicitly closed <li>', () => {
    expect(htmlToText('<ul><li>a<li>b</ul>')).toBe('- a\n- b')
  })

  it('joins table cells with tabs and rows with newlines', () => {
    expect(
      htmlToText('<table><tr><th>k</th><th>v</th></tr><tr><td>a</td><td>1</td></tr></table>'),
    ).toBe('k\tv\na\t1')
  })
})

describe('htmlToText: skipped content', () => {
  it('drops script, style, template, noscript, head and svg contents', () => {
    const html =
      '<head><title>T</title></head><script>var x = "<p>no</p>"</script>' +
      '<style>p{}</style><template>t</template><noscript>n</noscript>' +
      '<svg><text>s</text></svg>kept'
    expect(htmlToText(html)).toBe('kept')
  })

  it('does not end a script at a nested tag that looks like a close', () => {
    expect(htmlToText('<script>if (a</b) {}</script>ok')).toBe('ok')
  })

  it('drops comments, including empty Angular markers', () => {
    expect(htmlToText('a<!---->b<!-- <p>c</p> -->d')).toBe('abd')
  })

  it('drops doctype and processing instructions', () => {
    expect(htmlToText('<!DOCTYPE html><?xml version="1.0"?>x')).toBe('x')
  })

  it('drops the text of role="img" elements (icon ligatures)', () => {
    expect(htmlToText('<span>Open <i role="img" class="material-icons">expand_less</i></span>')).toBe(
      'Open',
    )
  })

  it('drops elements with the hidden attribute', () => {
    expect(htmlToText('<div>a</div><div hidden>b</div><div>c</div>')).toBe('a\nc')
  })

  it('drops elements with inline display:none', () => {
    expect(htmlToText('a<span style="color: red; display : none">b</span>c')).toBe('ac')
  })

  it('does not drop aria-hidden elements (they are often visible)', () => {
    expect(htmlToText('<span aria-hidden="true">visible</span>')).toBe('visible')
  })

  it('keeps class-hidden elements by default', () => {
    expect(htmlToText('<div class="buttons hidden">b</div>')).toBe('b')
  })

  it('drops class-hidden elements when asked', () => {
    const html = '<div>a</div><div class="x hide">b</div><span class="sr-only">c</span>d'
    expect(htmlToText(html, { skipHiddenClasses: true })).toBe('a\nd')
  })

  it('matches hidden classes as whole words only', () => {
    expect(htmlToText('<div class="hidden-xs unhide">a</div>', { skipHiddenClasses: true })).toBe(
      'a',
    )
  })

  it('drops void elements inside a hidden subtree without desyncing', () => {
    expect(htmlToText('<div hidden><img src="x"><br>gone</div>kept')).toBe('kept')
  })
})

describe('htmlToText: links', () => {
  it('shows link text only by default', () => {
    expect(htmlToText('see <a href="https://x.test/">docs</a>.')).toBe('see docs.')
  })

  it('appends the URL when asked', () => {
    expect(htmlToText('see <a href="https://x.test/?a=1&amp;b=2">docs</a>.', { linkUrls: true })).toBe(
      'see docs <https://x.test/?a=1&b=2>.',
    )
  })

  it('does not repeat a URL that is already the link text', () => {
    expect(htmlToText('<a href="https://x.test/">https://x.test/</a>', { linkUrls: true })).toBe(
      'https://x.test/',
    )
  })

  it('ignores fragment and javascript: hrefs', () => {
    expect(
      htmlToText('<a href="#top">up</a> <a href="javascript:void 0">go</a>', { linkUrls: true }),
    ).toBe('up go')
  })
})

describe('htmlToText: malformed input', () => {
  it('treats a stray < as text', () => {
    expect(htmlToText('1 < 2 and 3<4')).toBe('1 < 2 and 3<4')
  })

  it('tolerates an unterminated tag', () => {
    expect(htmlToText('a <div class="x')).toBe('a')
  })

  it('tolerates an unterminated comment', () => {
    expect(htmlToText('a<!-- b')).toBe('a')
  })

  it('tolerates unclosed and stray closing tags', () => {
    expect(htmlToText('<div><p>a</span></div></div>b')).toBe('a\n\nb')
  })

  it('handles > inside quoted attribute values', () => {
    expect(htmlToText('<a title="a > b">x</a>')).toBe('x')
  })

  it('decodes entities in text', () => {
    expect(htmlToText('<p>Tom &amp; Jerry&hellip;</p>')).toBe('Tom & Jerry…')
  })

  it('never throws and never returns tag syntax for well-formed markup', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = htmlToText(s)
        expect(typeof out).toBe('string')
      }),
    )
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z ]*$/), (s) => {
        expect(htmlToText(`<div><p>${s}</p></div>`)).not.toMatch(/[<>]/)
      }),
    )
  })
})

describe('htmlToText: real-world fixture', () => {
  it('extracts a Play Console notification', () => {
    const html = readFileSync(new URL('./fixture-notification.html', import.meta.url), 'utf8')
    expect(htmlToText(html)).toBe(
      [
        'New',
        'Headroom: Volume Booster EQ',
        'Sep 23',
        'An SDK version you are using is outdated',
        '',
        'androidx.fragment:fragment has reported fragment:1.1.0 as outdated. Consider updating to a newer SDK version.',
        '',
        'Affected app bundles and APKs:',
        '',
        '- version: 2 (0.2.0), release: 0.2.0',
        '',
        'If you have questions about this SDK, contact the SDK provider.',
        '',
        'Learn more',
      ].join('\n'),
    )
  })

  it('drops the hidden button row when class heuristics are on', () => {
    const html = readFileSync(new URL('./fixture-notification.html', import.meta.url), 'utf8')
    const out = htmlToText(html, { skipHiddenClasses: true })
    expect(out).not.toContain('Learn more')
    expect(out).not.toContain('New')
    expect(out.startsWith('Headroom: Volume Booster EQ\nSep 23\n')).toBe(true)
  })
})
