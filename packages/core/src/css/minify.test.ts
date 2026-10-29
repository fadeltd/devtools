import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { minifyCss } from './minify.ts'

describe('minifyCss', () => {
  it('collapses whitespace and drops the last semicolon in each block', () => {
    expect(minifyCss('a ,\nb  >  c {\n  color : red ;\n  margin: 0  auto;\n}\n')).toBe(
      'a,b>c{color :red;margin:0 auto}',
    )
  })

  it('handles nested blocks', () => {
    expect(minifyCss('@media screen and (min-width: 600px) {\n  a { b: c; }\n}')).toBe(
      '@media screen and (min-width:600px){a{b:c}}',
    )
  })

  it('strips comments but keeps /*! licence */ comments', () => {
    expect(minifyCss('/*! license: MIT */\n/* gone */\na { /* also gone */ b: c; }')).toBe(
      '/*! license: MIT */ a{b:c}',
    )
  })

  it('keeps a separator where a comment sat between two tokens', () => {
    expect(minifyCss('a{border:1px/**/solid}')).toBe('a{border:1px solid}')
  })

  it('leaves strings alone, braces and all', () => {
    expect(minifyCss('a::before { content: "  }  {  ;  " ; }')).toBe(
      'a::before{content:"  }  {  ;  "}',
    )
    expect(minifyCss("a::after { content: '\\'  x' }")).toBe("a::after{content:'\\'  x'}")
  })

  it('copies an unquoted url(data:…) body verbatim', () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo+/=;a,b'
    expect(minifyCss(`a { background: url( ${uri} )  no-repeat ; }`)).toBe(
      `a{background:url(${uri}) no-repeat}`,
    )
  })

  it('leaves a quoted url() string alone', () => {
    expect(minifyCss(`a { b: url( "x  y.png" ) }`)).toBe('a{b:url("x  y.png")}')
  })

  it('keeps the spaces calc() needs around + and -', () => {
    expect(minifyCss('a { width: calc( 100% - 2 * ( 1px + 2px ) ); }')).toBe(
      'a{width:calc(100% - 2 * (1px + 2px))}',
    )
    expect(minifyCss('a { width: calc(1px + -2px) }')).toBe('a{width:calc(1px + -2px)}')
  })

  it('tightens the + combinator outside parentheses', () => {
    expect(minifyCss('a + b ~ c { x: y }')).toBe('a+b~c{x:y}')
  })

  it('keeps !important, tightened', () => {
    expect(minifyCss('a { color: red !important; b: c ! important }')).toBe(
      'a{color:red!important;b:c!important}',
    )
  })

  it('keeps the space that makes a descendant pseudo-class', () => {
    expect(minifyCss('a :hover { x: y }')).toBe('a :hover{x:y}')
  })

  it('drops empty declarations', () => {
    expect(minifyCss('a { b: c;; ; d: e; }')).toBe('a{b:c;d:e}')
  })

  it('keeps the space that ends a hex escape', () => {
    // `.\31 0` is the class "10"; a second space would be a descendant combinator.
    expect(minifyCss('.\\31 0  .x { a: b }')).toBe('.\\31 0 .x{a:b}')
    expect(minifyCss('.\\31  .x { a: b }')).toBe('.\\31  .x{a:b}')
  })

  it('is empty for blank input', () => {
    expect(minifyCss(' \n\t ')).toBe('')
  })

  it('keeps the newline that ends a broken string', () => {
    expect(minifyCss("a{b:'x\n  c:d}")).toBe("a{b:'x\nc:d}")
  })

  // Idempotence catches the subtle failures: a space dropped or added on the
  // first pass that changes how the second pass tokenizes the result.
  it('is idempotent, even on garbage', () => {
    const pieces = fc.constantFrom(...'a1 \n{};:()+-*/,>!"\'\\', '/*', '*/', '/*!', 'url')
    const css = fc.array(pieces, { maxLength: 40 }).map((a) => a.join(''))
    fc.assert(
      fc.property(css, (s) => minifyCss(minifyCss(s)) === minifyCss(s)),
      { numRuns: 3000 },
    )
  })
})
