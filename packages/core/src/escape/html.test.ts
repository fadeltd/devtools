import { describe, expect, it } from 'vitest'
import { escapeHtml, unescapeHtml } from './html.ts'

describe('escapeHtml', () => {
  it('escapes the five characters that matter, and only those', () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a> é`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt; é',
    )
  })
})

describe('unescapeHtml', () => {
  it('decodes named, decimal and hex references in one pass', () => {
    expect(unescapeHtml('&lt;b&gt; &copy; &#169; &#xA9; &amp;lt;')).toEqual({
      ok: true,
      output: '<b> © © © &lt;',
      warnings: [],
    })
  })

  it('applies the windows-1252 remap browsers use', () => {
    expect(unescapeHtml('&#150;')).toMatchObject({ output: '–' })
  })

  it('leaves unknown names and unterminated references as typed, with a warning for unknown names', () => {
    const r = unescapeHtml('a &bogus; b &nope; c &amp')
    expect(r).toMatchObject({ ok: true, output: 'a &bogus; b &nope; c &amp' })
    if (r.ok) expect(r.warnings).toEqual(['&bogus; at position 3 is not an entity this tool knows, so it was left as is (2 in total).'])
  })

  it('warns when a numeric reference is not a character', () => {
    const r = unescapeHtml('x&#0;&#xD800;&#xFFFD;')
    expect(r).toMatchObject({ ok: true, output: 'x\uFFFD\uFFFD\uFFFD' })
    if (r.ok) expect(r.warnings).toEqual(['&#0; at position 2 is not a valid character, so it became U+FFFD, as a browser does (2 in total).'])
  })
})
