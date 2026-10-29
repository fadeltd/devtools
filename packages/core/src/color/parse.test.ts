import { describe, expect, it } from 'vitest'
import { describeColor } from './format.ts'
import { NAMED_COLORS } from './named.ts'
import { parseColor } from './parse.ts'

/** Parse and return the hex the converter would show, or the error code. */
function hex(input: string): string {
  const r = parseColor(input)
  return r.ok ? describeColor(r.color).css.hex : `error:${r.error.code}`
}

function error(input: string) {
  const r = parseColor(input)
  if (r.ok) throw new Error(`expected ${input} to fail`)
  return r.error
}

describe('hex', () => {
  it('reads all four lengths', () => {
    expect(hex('#f80')).toBe('#ff8800')
    expect(hex('#f808')).toBe('#ff880088')
    expect(hex('#FF8800')).toBe('#ff8800')
    expect(hex('#ff880080')).toBe('#ff880080')
  })

  it('ignores surrounding whitespace', () => {
    expect(hex('  #ff8800\n')).toBe('#ff8800')
  })

  it('accepts 6 and 8 digits without a #, and says so', () => {
    const r = parseColor('3b82f6')
    expect(r.ok && r.notes).toEqual(['Read as #3b82f6.'])
    expect(hex('3b82f680')).toBe('#3b82f680')
    // Three letters is a word, not a color.
    expect(hex('add')).toBe('error:unknown-name')
  })

  it('points at the bad digit', () => {
    expect(error('#ff88zz')).toMatchObject({ code: 'hex-digit', index: 5, char: 'z' })
    expect(error('  #12g')).toMatchObject({ code: 'hex-digit', index: 5 })
  })

  it('rejects other lengths', () => {
    expect(error('#12345')).toMatchObject({ code: 'hex-length', index: 1 })
    expect(error('#')).toMatchObject({ code: 'hex-length' })
  })
})

describe('rgb()', () => {
  it('reads comma and space syntax, with and without alpha', () => {
    expect(hex('rgb(255, 136, 0)')).toBe('#ff8800')
    expect(hex('rgb(255 136 0)')).toBe('#ff8800')
    expect(hex('rgba(255, 136, 0, 0.5)')).toBe('#ff880080')
    expect(hex('rgb(255 136 0 / 0.5)')).toBe('#ff880080')
    expect(hex('rgb(255 136 0 / 50%)')).toBe('#ff880080')
    // rgba is an alias, and rgb takes a legacy alpha too.
    expect(hex('rgba(255 136 0)')).toBe('#ff8800')
    expect(hex('rgb(255, 136, 0, 1)')).toBe('#ff8800')
  })

  it('reads percentages, fractions and exponents', () => {
    expect(hex('rgb(100%, 0%, 50%)')).toBe('#ff0080')
    expect(hex('rgb(127.5 0 1e2)')).toBe('#800064')
    expect(hex('RGB(.5e1 +0 -0)')).toBe('#050000')
  })

  it('treats none as zero', () => {
    expect(hex('rgb(none 255 none)')).toBe('#00ff00')
    expect(hex('rgb(255 0 0 / none)')).toBe('#ff000000')
  })

  it('clamps out-of-range values as a browser does, and notes it', () => {
    const r = parseColor('rgb(300 -5 0 / 2)')
    expect(r.ok && describeColor(r.color).css.hex).toBe('#ff0000')
    expect(r.ok && r.notes).toHaveLength(3)
  })

  it('rejects a mix of commas and spaces', () => {
    expect(error('rgb(255, 136 0)')).toMatchObject({ code: 'syntax', index: 13 })
    expect(error('rgb(255 136, 0)')).toMatchObject({ code: 'syntax' })
  })

  it('rejects a mix of numbers and percentages in comma syntax only', () => {
    expect(error('rgb(255, 50%, 0)')).toMatchObject({ code: 'syntax', index: 9 })
    expect(hex('rgb(255 50% 0)')).toBe('#ff8000')
  })

  it('rejects none and slash in comma syntax', () => {
    expect(error('rgb(255, none, 0)').code).toBe('syntax')
    expect(error('rgb(255, 0, 0 / 0.5)').code).toBe('syntax')
  })

  it('counts values', () => {
    expect(error('rgb(1 2)')).toMatchObject({ code: 'count', index: 7 })
    expect(error('rgb(1 2 3 4)')).toMatchObject({ code: 'count', index: 10 })
    expect(error('rgb(1, 2, 3, 4, 5)').code).toBe('count')
    expect(error('rgb(1 2 3 /)').code).toBe('syntax')
    expect(error('rgb(1, 2, 3,)').code).toBe('syntax')
  })

  it('reports a missing paren, a bad unit and trailing text by position', () => {
    expect(error('rgb(1 2 3')).toMatchObject({ code: 'unclosed', index: 9 })
    expect(error('rgb(1px 2 3)')).toMatchObject({ code: 'unit', index: 5 })
    expect(error('rgb(1 2 3) red')).toMatchObject({ code: 'trailing', index: 11 })
    expect(error('rgb(1 2 3deg)')).toMatchObject({ code: 'unit', index: 8 })
    expect(error('rgb(1 x 3)')).toMatchObject({ code: 'unexpected', index: 6 })
  })
})

describe('hsl()', () => {
  it('reads comma and space syntax', () => {
    expect(hex('hsl(120, 100%, 50%)')).toBe('#00ff00')
    expect(hex('hsl(120 100% 50%)')).toBe('#00ff00')
    expect(hex('hsla(120, 100%, 50%, 0.5)')).toBe('#00ff0080')
    expect(hex('hsl(120 100% 50% / 50%)')).toBe('#00ff0080')
  })

  it('reads every angle unit and a bare number', () => {
    for (const h of ['240', '240deg', '266.6667grad', `${(4 * Math.PI) / 3}rad`, '0.6667turn', '-120deg', '600']) {
      expect(hex(`hsl(${h} 100% 50%)`), h).toBe('#0000ff')
    }
  })

  it('takes bare numbers for s and l only in space syntax', () => {
    expect(hex('hsl(0 100 50)')).toBe('#ff0000')
    expect(error('hsl(0, 100, 50%)')).toMatchObject({ code: 'unit', index: 7 })
  })

  it('treats a none hue as 0', () => {
    expect(hex('hsl(none 100% 50%)')).toBe('#ff0000')
  })

  it('rejects a percentage hue', () => {
    expect(error('hsl(50% 100% 50%)')).toMatchObject({ code: 'unit', index: 4 })
  })
})

describe('oklch()', () => {
  it('reads lightness as a number or a percentage', () => {
    expect(hex('oklch(62.8% 0.2577 29.23)')).toBe('#ff0000')
    expect(hex('oklch(0.628 0.2577 29.23)')).toBe('#ff0000')
    expect(hex('oklch(1 0 0)')).toBe('#ffffff')
  })

  it('reads chroma as a percentage of 0.4', () => {
    expect(hex('oklch(62.8% 64.425% 29.23)')).toBe('#ff0000')
  })

  it('reads alpha, angle units and none', () => {
    expect(hex('oklch(62.8% 0.2577 29.23 / 0.5)')).toBe('#ff000080')
    expect(hex('oklch(62.8% 0.2577 0.0812turn)')).toBe('#ff0000')
    expect(hex('oklch(100% none none)')).toBe('#ffffff')
  })

  it('keeps an out-of-gamut color as written', () => {
    const r = parseColor('oklch(70% 0.4 150)')
    expect(r.ok && r.color).toEqual({ space: 'oklch', l: 0.7, c: 0.4, h: 150, alpha: 1 })
  })

  it('clamps lightness and negative chroma', () => {
    const r = parseColor('oklch(120% -0.1 0)')
    expect(r.ok && r.color).toMatchObject({ l: 1, c: 0 })
    expect(r.ok && r.notes).toHaveLength(2)
  })

  it('has no comma syntax', () => {
    expect(error('oklch(0.5, 0.1, 30)')).toMatchObject({ code: 'syntax', index: 9 })
  })
})

describe('named colors', () => {
  it('has all 148', () => {
    expect(Object.keys(NAMED_COLORS)).toHaveLength(148)
  })

  it('pins values that are easy to typo', () => {
    expect(hex('rebeccapurple')).toBe('#663399')
    expect(hex('lightgoldenrodyellow')).toBe('#fafad2')
    expect(hex('navajowhite')).toBe('#ffdead')
    expect(hex('darkgrey')).toBe(hex('darkgray'))
    expect(hex('CornflowerBlue')).toBe('#6495ed')
  })

  it('reads transparent', () => {
    expect(hex('transparent')).toBe('#00000000')
  })

  it('reports unknown names and functions', () => {
    expect(error('reddish')).toMatchObject({ code: 'unknown-name', index: 0 })
    expect(error('currentColor').code).toBe('context')
    expect(error('lab(50% 40 59)').code).toBe('unsupported')
    expect(error('rgbx(1 2 3)').code).toBe('unknown-function')
    expect(error('red blue')).toMatchObject({ code: 'trailing', index: 3 })
    expect(error('red;')).toMatchObject({ code: 'unexpected', index: 3 })
  })
})

it('reports empty input without a position', () => {
  expect(error('   ')).toEqual({ code: 'empty', message: 'Enter a color.' })
  expect(error('(1 2 3)')).toMatchObject({ code: 'unexpected', index: 0 })
})
