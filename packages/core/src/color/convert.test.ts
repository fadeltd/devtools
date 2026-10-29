import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { clipToSrgb, hslToRgb, isInGamut, oklchToRgb, rgbToHsl, rgbToOklch, type Rgb } from './convert.ts'
import { describeColor, formatHex, formatHsl, formatNumber, formatOklch, formatRgb } from './format.ts'
import { parseColor } from './parse.ts'

const byteArb = fc.integer({ min: 0, max: 255 })
const rgbArb = fc.tuple(byteArb, byteArb, byteArb)
const toRgb = ([r, g, b]: [number, number, number]): Rgb => ({ r: r / 255, g: g / 255, b: b / 255 })
const bytesOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

function info(input: string) {
  const r = parseColor(input)
  if (!r.ok) throw new Error(r.error.message)
  return describeColor(r.color)
}

describe('OKLab', () => {
  // Reference values from Björn Ottosson's post and the CSS Color 4 spec.
  it('matches published values', () => {
    const red = rgbToOklch({ r: 1, g: 0, b: 0 })
    expect(red.l).toBeCloseTo(0.62796, 4)
    expect(red.c).toBeCloseTo(0.25768, 4)
    expect(red.h).toBeCloseTo(29.2339, 2)
    const white = rgbToOklch({ r: 1, g: 1, b: 1 })
    expect(white.l).toBeCloseTo(1, 6)
    expect(white.c).toBeCloseTo(0, 6)
  })

  it('round-trips hex → OKLCH → hex within ±1 per channel', () => {
    fc.assert(
      fc.property(rgbArb, (bytes) => {
        const back = formatHex(oklchToRgb(rgbToOklch(toRgb(bytes))))
        bytesOf(back).forEach((v, i) => expect(Math.abs(v - bytes[i]!)).toBeLessThanOrEqual(1))
      }),
    )
  })

  it('round-trips through the printed oklch() string within ±1 and stays in gamut', () => {
    fc.assert(
      fc.property(rgbArb, (bytes) => {
        const hex = formatHex(toRgb(bytes))
        const back = info(info(hex).css.oklch)
        expect(back.inGamut).toBe(true)
        bytesOf(back.css.hex).forEach((v, i) => expect(Math.abs(v - bytes[i]!)).toBeLessThanOrEqual(1))
      }),
      { numRuns: 2000 },
    )
  })
})

describe('HSL', () => {
  it('converts the primaries', () => {
    expect(rgbToHsl({ r: 0, g: 0, b: 1 })).toEqual({ h: 240, s: 100, l: 50 })
    expect(hslToRgb({ h: 240, s: 100, l: 50 })).toEqual({ r: 0, g: 0, b: 1 })
  })

  it('round-trips through the printed hsl() string exactly', () => {
    fc.assert(
      fc.property(rgbArb, (bytes) => {
        const hex = formatHex(toRgb(bytes))
        expect(info(info(hex).css.hsl).css.hex).toBe(hex)
      }),
      { numRuns: 2000 },
    )
  })
})

describe('gamut', () => {
  it('detects an out-of-gamut OKLCH color and clips chroma only', () => {
    const c = info('oklch(70% 0.4 150)')
    expect(c.inGamut).toBe(false)
    expect(c.clipped).not.toBeNull()
    expect(c.clipped!.l).toBe(0.7)
    expect(c.clipped!.h).toBe(150)
    expect(c.clipped!.c).toBeLessThan(0.4)
    expect(c.clipped!.c).toBeGreaterThan(0.15)
    // The clip lands on the gamut boundary, not well inside it.
    expect(isInGamut(oklchToRgb({ ...c.clipped!, c: c.clipped!.c + 0.005 }), 0)).toBe(false)
    // The original is shown as written; the sRGB rows show the clipped color.
    expect(c.css.oklch).toBe('oklch(70% 0.4 150)')
    expect(c.css.clippedOklch).toMatch(/^oklch\(70% 0\.\d+ 150\)$/)
    expect(info(c.css.clippedOklch!).inGamut).toBe(true)
  })

  it('treats every sRGB color as in gamut', () => {
    expect(info('#ff0000').inGamut).toBe(true)
    expect(info('oklch(62.8% 0.2577 29.23)').inGamut).toBe(true)
  })

  it('clips toward a gray at the extremes', () => {
    expect(formatHex(clipToSrgb({ l: 1, c: 0.3, h: 40 }).rgb)).toBe('#ffffff')
    expect(formatHex(clipToSrgb({ l: 0, c: 0.3, h: 40 }).rgb)).toBe('#000000')
  })
})

describe('formatting', () => {
  it('prints canonical CSS', () => {
    const c = info('#3b82f6')
    expect(c.css).toMatchObject({
      hex: '#3b82f6',
      rgb: 'rgb(59 130 246)',
      hsl: 'hsl(217.2 91.2% 59.8%)',
      oklch: 'oklch(62.31% 0.188 259.81)',
    })
  })

  it('prints alpha only when present', () => {
    const c = info('rgb(59 130 246 / 50%)')
    expect(c.alpha).toBe(0.5)
    expect(c.css.hex).toBe('#3b82f680')
    expect(c.css.rgb).toBe('rgb(59 130 246 / 0.5)')
    expect(c.css.hsl).toBe('hsl(217.2 91.2% 59.8% / 0.5)')
    expect(c.css.oklch).toBe('oklch(62.31% 0.188 259.81 / 0.5)')
  })

  it('prints a gray with hue 0, not float noise', () => {
    expect(info('#777').css.oklch).toBe('oklch(56.93% 0 0)')
    expect(info('#777').css.hsl).toBe('hsl(0 0% 46.7%)')
    expect(formatOklch({ l: 0.5, c: 0.00001, h: 123.4 })).toBe('oklch(50% 0 0)')
    expect(formatHsl({ h: 99, s: 0.01, l: 50 })).toBe('hsl(0 0% 50%)')
  })

  it('clamps when printing sRGB', () => {
    expect(formatRgb({ r: 1.2, g: -0.1, b: 0.5 })).toBe('rgb(255 0 128)')
  })

  it('trims trailing zeros and never prints -0', () => {
    expect(formatNumber(1.5, 3)).toBe('1.5')
    expect(formatNumber(100, 2)).toBe('100')
    expect(formatNumber(-0.0001, 2)).toBe('0')
  })

  it('names exact matches, both names when there are two', () => {
    expect(info('#0ff').names).toEqual(['aqua', 'cyan'])
    expect(info('#663399').names).toEqual(['rebeccapurple'])
    expect(info('#663398').names).toEqual([])
    expect(info('#66339980').names).toEqual([])
    expect(info('transparent').names).toEqual(['transparent'])
  })
})
