import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { checkContrast, contrastRatio, formatRatio, relativeLuminance, suggestForeground, WCAG } from './contrast.ts'
import type { Color } from './convert.ts'
import { parseColor } from './parse.ts'

function color(input: string): Color {
  const r = parseColor(input)
  if (!r.ok) throw new Error(r.error.message)
  return r.color
}

const byteArb = fc.integer({ min: 0, max: 255 })
const colorArb = fc
  .tuple(byteArb, byteArb, byteArb)
  .map(([r, g, b]): Color => ({ space: 'srgb', r: r / 255, g: g / 255, b: b / 255, alpha: 1 }))

describe('ratio', () => {
  it('is 21 for black on white and 1 for a color on itself', () => {
    expect(checkContrast(color('#000'), color('#fff')).ratio).toBeCloseTo(21, 10)
    expect(checkContrast(color('#fff'), color('#000')).ratio).toBeCloseTo(21, 10)
    expect(checkContrast(color('red'), color('red')).ratio).toBe(1)
  })

  it('gives #777 on white about 4.48, which fails AA', () => {
    const r = checkContrast(color('#777'), color('#fff'))
    expect(r.ratio).toBeCloseTo(4.48, 2)
    expect(r.pass).toEqual({ aaNormal: false, aaLarge: true, aaaNormal: false, aaaLarge: false, ui: true })
  })

  it('uses the WCAG luminance weights', () => {
    expect(relativeLuminance({ r: 1, g: 0, b: 0 })).toBeCloseTo(0.2126, 10)
    expect(relativeLuminance({ r: 0, g: 1, b: 0 })).toBeCloseTo(0.7152, 10)
  })

  it('is symmetric and between 1 and 21', () => {
    fc.assert(
      fc.property(colorArb, colorArb, (a, b) => {
        const ra = checkContrast(a, b).ratio
        expect(ra).toBeCloseTo(checkContrast(b, a).ratio, 10)
        expect(ra).toBeGreaterThanOrEqual(1)
        expect(ra).toBeLessThanOrEqual(21 + 1e-9)
      }),
    )
  })

  it('rounds the printed ratio down, so a failing ratio never prints as the threshold', () => {
    expect(formatRatio(4.4999)).toBe('4.49:1')
    expect(formatRatio(4.478)).toBe('4.47:1')
    expect(formatRatio(21)).toBe('21:1')
    expect(formatRatio(3)).toBe('3:1')
    expect(formatRatio(4.5)).toBe('4.5:1')
  })
})

describe('alpha', () => {
  it('blends a translucent foreground over the background first, and says so', () => {
    const r = checkContrast(color('rgb(0 0 0 / 0.5)'), color('#fff'))
    // 50% black on white is #808080 (rounded), not black.
    expect(r.ratio).toBeCloseTo(contrastRatio({ r: 0.5, g: 0.5, b: 0.5 }, { r: 1, g: 1, b: 1 }), 10)
    expect(r.ratio).toBeLessThan(5)
    expect(r.notes.join(' ')).toMatch(/50% opaque.*blended/)
  })

  it('measures a translucent background over white, and says so', () => {
    const r = checkContrast(color('#000'), color('rgb(0 0 0 / 0)'))
    expect(r.ratio).toBeCloseTo(21, 10)
    expect(r.notes.join(' ')).toMatch(/over white/)
  })

  it('notes an out-of-gamut color', () => {
    expect(checkContrast(color('oklch(70% 0.4 150)'), color('#fff')).notes.join(' ')).toMatch(/outside sRGB/)
  })
})

describe('suggestForeground', () => {
  it('darkens #777 on white just enough for AA, and keeps it gray', () => {
    const s = suggestForeground(color('#777'), color('#fff'), WCAG.aaNormal)!
    expect(s.hex).toBe('#767676')
    expect(s.ratio).toBeGreaterThanOrEqual(4.5)
    expect(s.deltaL).toBeLessThan(0)
  })

  it('lightens on a dark background', () => {
    const s = suggestForeground(color('#555'), color('#000'), WCAG.aaaNormal)!
    expect(s.deltaL).toBeGreaterThan(0)
    expect(s.ratio).toBeGreaterThanOrEqual(7)
  })

  it('keeps the hue of a colored foreground', () => {
    const s = suggestForeground(color('#3b82f6'), color('#fff'), WCAG.aaNormal)!
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(s.hex.slice(i, i + 2), 16))
    expect(b).toBeGreaterThan(r!)
    expect(b).toBeGreaterThan(g!)
  })

  it('returns the color itself when it already passes', () => {
    expect(suggestForeground(color('#000'), color('#fff'), 7)).toMatchObject({ hex: '#000000', deltaL: 0 })
  })

  it('returns null when no lightness reaches the target', () => {
    // Mid-gray: black gives ~4.7 and white ~4.5, so 7 is out of reach.
    expect(suggestForeground(color('#777'), color('#777'), 7)).toBeNull()
  })

  it('always meets the target it returns, measured on the hex itself', () => {
    fc.assert(
      fc.property(colorArb, colorArb, fc.constantFrom(WCAG.aaLarge, WCAG.aaNormal, WCAG.aaaNormal), (fg, bg, target) => {
        const s = suggestForeground(fg, bg, target)
        if (s === null) {
          // Only allowed when neither black nor white gets there.
          const best = Math.max(checkContrast(color('#000'), bg).ratio, checkContrast(color('#fff'), bg).ratio)
          expect(best).toBeLessThan(target)
          return
        }
        expect(checkContrast(color(s.hex), bg).ratio).toBeGreaterThanOrEqual(target)
      }),
      { numRuns: 300 },
    )
  })

  it('always finds AA, since black or white always reaches 4.5', () => {
    fc.assert(
      fc.property(colorArb, colorArb, (fg, bg) => {
        expect(suggestForeground(fg, bg, WCAG.aaNormal)).not.toBeNull()
      }),
      { numRuns: 200 },
    )
  })
})
