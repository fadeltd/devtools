import { describe, expect, it } from 'vitest'
import { formatCss, parseCssError, type CssResult } from './format.ts'

function output(r: CssResult): string {
  if (!r.ok) throw new Error(`expected success, got: ${r.error.message}`)
  return r.output
}

describe('formatCss', () => {
  it('formats CSS', async () => {
    expect(output(await formatCss('a{color:red;background:BLUE}'))).toBe(
      'a {\n  color: red;\n  background: BLUE;\n}\n',
    )
  })

  it('formats SCSS', async () => {
    const r = await formatCss('$c:red;.a{&:hover{color:$c}@include m(1px)}', { parser: 'scss' })
    expect(output(r)).toBe('$c: red;\n.a {\n  &:hover {\n    color: $c;\n  }\n  @include m(1px);\n}\n')
  })

  it('formats Less', async () => {
    const r = await formatCss('@c:red;.a{color:@c;.mixin();}', { parser: 'less' })
    expect(output(r)).toBe('@c: red;\n.a {\n  color: @c;\n  .mixin();\n}\n')
  })

  it('honours tab width, tabs and quote style', async () => {
    const src = 'a{content:"x"}'
    expect(output(await formatCss(src, { tabWidth: 4 }))).toBe('a {\n    content: "x";\n}\n')
    expect(output(await formatCss(src, { useTabs: true }))).toBe('a {\n\tcontent: "x";\n}\n')
    expect(output(await formatCss(src, { singleQuote: true }))).toBe("a {\n  content: 'x';\n}\n")
  })

  it('honours print width', async () => {
    const src = 'a{grid-template-columns:[full-start] minmax(1rem,1fr) [content-start] minmax(0,60rem) [content-end] minmax(1rem,1fr) [full-end]}'
    const narrow = output(await formatCss(src, { printWidth: 40 }))
    const wide = output(await formatCss(src, { printWidth: 200 }))
    expect(narrow.split('\n').length).toBeGreaterThan(wide.split('\n').length)
  })

  it('returns empty output for blank input', async () => {
    expect(await formatCss('\n  ')).toEqual({ ok: true, output: '' })
  })

  it('reports a syntax error with its position', async () => {
    const r = await formatCss('a {\n  color: red;\n  b: "unclosed\n}')
    expect(r).toEqual({
      ok: false,
      error: { message: 'Unclosed string', line: 3, column: 6 },
    })
  })

  it('reports an unclosed block', async () => {
    const r = await formatCss('.a {\n  color: red;\n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.message).toBe('Unclosed block')
    expect(r.error.line).toBe(1)
  })

  it('reports SCSS errors too', async () => {
    const r = await formatCss('.a { color: red; }\n}', { parser: 'scss' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.line).toBe(2)
  })
})

describe('parseCssError', () => {
  it('drops the code frame and the inline position', () => {
    const e = Object.assign(new SyntaxError('CssSyntaxError: Unexpected } (1:4)\n> 1 | a{}}\n    |    ^'), {
      loc: { start: { line: 1, column: 4 } },
    })
    expect(parseCssError(e)).toEqual({ message: 'Unexpected }', line: 1, column: 4 })
  })

  it('falls back to the position in the message', () => {
    expect(parseCssError(new Error('Unknown word (2:5)'))).toEqual({
      message: 'Unknown word',
      line: 2,
      column: 5,
    })
  })

  it('has no position when there is none', () => {
    expect(parseCssError('nope')).toEqual({ message: 'nope', line: null, column: null })
  })
})
