import { clipToSrgb, rgbToOklch, srgbToLinear, type Color, type Rgb } from './convert.ts'
import { describeColor, formatHex, formatNumber } from './format.ts'

/** WCAG 2.x minimum contrast ratios (SC 1.4.3, 1.4.6 and 1.4.11). */
export const WCAG = {
  aaNormal: 4.5,
  aaLarge: 3,
  aaaNormal: 7,
  aaaLarge: 4.5,
  /** Non-text: UI components, focus rings, icons and graph lines. */
  ui: 3,
} as const

export type WcagCheck = keyof typeof WCAG

/**
 * WCAG relative luminance of a gamma-encoded sRGB color.
 *
 * WCAG 2.0 printed the linearisation threshold as 0.03928, a typo for the sRGB
 * standard's 0.04045 that WCAG 2.2 corrected. No 8-bit value falls between the
 * two, so either gives the same answer; this uses the standard's.
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

/** (lighter + 0.05) / (darker + 0.05): 1 for identical colors, 21 for black on white. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The ratio as people quote it, to two decimals and rounded *down*. WCAG has
 * no rounding: 4.499 fails 4.5, so printing it as "4.50" would show a passing
 * number next to a failing verdict.
 */
export function formatRatio(ratio: number): string {
  const floored = Math.floor(ratio * 100 + 1e-9) / 100
  return `${floored.toFixed(2).replace(/\.?0+$/, '')}:1`
}

/** Source-over blending of a translucent color onto an opaque one, in gamma-encoded sRGB as browsers do. */
export function composite(top: Rgb, alpha: number, under: Rgb): Rgb {
  const mix = (t: number, u: number) => t * alpha + u * (1 - alpha)
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b) }
}

const WHITE: Rgb = { r: 1, g: 1, b: 1 }

export interface ContrastReport {
  ratio: number
  /** The opaque foreground actually measured (after blending, if it had alpha). */
  fg: Rgb
  /** The opaque background actually measured. */
  bg: Rgb
  pass: Record<WcagCheck, boolean>
  /** Assumptions made to get a single number, phrased for the user. */
  notes: string[]
}

/**
 * Contrast of text in `fg` on `bg`. A ratio is only defined between opaque
 * colors, so a translucent foreground is first blended over the background
 * (what the reader actually sees), and a translucent background over white,
 * the browser's default canvas. Out-of-gamut OKLCH is measured as the sRGB
 * color a screen will actually show.
 */
export function checkContrast(fg: Color, bg: Color): ContrastReport {
  const notes: string[] = []
  const f = describeColor(fg)
  const b = describeColor(bg)

  let bgRgb = b.rgb
  if (b.alpha < 1) {
    bgRgb = composite(b.rgb, b.alpha, WHITE)
    notes.push(
      `The background is ${percent(b.alpha * 100)}% opaque. It is measured over white, as ${formatHex(bgRgb)}; over anything else the ratio changes.`,
    )
  }
  let fgRgb = f.rgb
  if (f.alpha < 1) {
    fgRgb = composite(f.rgb, f.alpha, bgRgb)
    notes.push(
      `The foreground is ${percent(f.alpha * 100)}% opaque, so it is blended over the background first and measured as ${formatHex(fgRgb)}.`,
    )
  }
  if (!f.inGamut) notes.push('The foreground is outside sRGB; measured as its in-gamut version.')
  if (!b.inGamut) notes.push('The background is outside sRGB; measured as its in-gamut version.')

  const ratio = contrastRatio(fgRgb, bgRgb)
  const pass = Object.fromEntries(
    (Object.keys(WCAG) as WcagCheck[]).map((k) => [k, ratio >= WCAG[k]]),
  ) as Record<WcagCheck, boolean>
  return { ratio, fg: fgRgb, bg: bgRgb, pass, notes }
}

function percent(n: number): string {
  // Whole percent, unless that would round 99.6% up to a misleading "100%".
  return formatNumber(n, (n > 99 && n < 100) || (n > 0 && n < 1) ? 1 : 0)
}

export interface Suggestion {
  /** Opaque, 8-bit: what to paste. Its ratio is measured on this exact hex. */
  hex: string
  rgb: Rgb
  ratio: number
  /** Signed change in OKLCH lightness from the measured foreground, 0–1 scale. */
  deltaL: number
}

/**
 * The foreground nearest the current one that reaches `target` on `bg`.
 *
 * Only OKLCH lightness moves; chroma and hue are kept (chroma is lowered only
 * where sRGB runs out of room near black and white), so the suggestion is
 * still recognisably "the same color, lighter" or "darker". Both directions
 * are searched and the smaller change wins. Returns null when no lightness
 * reaches the target, which happens only above about 4.58:1, for mid-tone
 * backgrounds where even black and white fall short.
 *
 * Every candidate is judged after rounding to 8-bit hex, so the returned hex
 * meets the target as pasted, not just in floating point.
 */
export function suggestForeground(fg: Color, bg: Color, target: number): Suggestion | null {
  const report = checkContrast(fg, bg)
  const bgRgb = report.bg
  const measured = rgbToOklch(report.fg)
  // A gray's chroma comes out as float noise (~1e-8) with a random hue. Left
  // in, that noise splits R, G and B across a rounding boundary and "suggests"
  // a faintly tinted gray like #777676 for #777777.
  const base = measured.c < 1e-4 ? { l: measured.l, c: 0, h: 0 } : measured

  const at = (l: number): { hex: string; rgb: Rgb; ratio: number } => {
    const { rgb } = clipToSrgb({ l, c: base.c, h: base.h })
    const hex = formatHex(rgb)
    const rounded = hexToRgb(hex)
    return { hex, rgb: rounded, ratio: contrastRatio(rounded, bgRgb) }
  }

  const search = (towards: 0 | 1): { l: number; ratio: number; hex: string; rgb: Rgb } | null => {
    const step = towards === 1 ? 0.01 : -0.01
    let prev = base.l
    if (at(prev).ratio >= target) return { l: prev, ...at(prev) }
    // Scan first, then bisect the first crossing: contrast is not strictly
    // monotonic in L once the gamut clip kicks in, so bisection alone could
    // skip past the nearest passing band.
    for (let l = base.l + step; towards === 1 ? l < 1 + step : l > -step; l += step) {
      const cur = Math.min(1, Math.max(0, l))
      if (at(cur).ratio >= target) {
        let fail = prev
        let ok = cur
        for (let i = 0; i < 20; i++) {
          const mid = (fail + ok) / 2
          if (at(mid).ratio >= target) ok = mid
          else fail = mid
        }
        return { l: ok, ...at(ok) }
      }
      prev = cur
    }
    return null
  }

  const up = search(1)
  const down = search(0)
  let best = up
  if (down !== null && (best === null || Math.abs(down.l - base.l) < Math.abs(best.l - base.l))) best = down
  if (best === null) return null
  return { hex: best.hex, rgb: best.rgb, ratio: best.ratio, deltaL: best.l - base.l }
}

function hexToRgb(hex: string): Rgb {
  const n = (k: number) => parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16) / 255
  return { r: n(0), g: n(1), b: n(2) }
}
