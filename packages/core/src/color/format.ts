import {
  clipToSrgb,
  isInGamut,
  oklchToRgb,
  rgbToHsl,
  rgbToOklch,
  clampRgb,
  type Color,
  type Hsl,
  type Oklch,
  type Rgb,
} from './convert.ts'
import { namesForHex } from './named.ts'

/** Round to `digits` decimals and drop trailing zeros; never prints "-0". */
export function formatNumber(n: number, digits: number): string {
  const s = n.toFixed(digits)
  const trimmed = s.includes('.') ? s.replace(/\.?0+$/, '') : s
  return trimmed === '-0' ? '0' : trimmed
}

const byte = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255)
const hex2 = (n: number) => n.toString(16).padStart(2, '0')

// Alpha keeps three decimals: enough to tell 8-bit alpha steps apart (1/255 ≈
// 0.004) without printing float noise like 0.50196.
const alphaSuffix = (alpha: number) => (alpha >= 1 ? '' : ` / ${formatNumber(alpha, 3)}`)

/** `#rrggbb`, or `#rrggbbaa` when not opaque. Lowercase, never shortened. */
export function formatHex(rgb: Rgb, alpha = 1): string {
  const base = `#${hex2(byte(rgb.r))}${hex2(byte(rgb.g))}${hex2(byte(rgb.b))}`
  return alpha >= 1 ? base : base + hex2(byte(alpha))
}

/** `rgb(59 130 246)` / `rgb(59 130 246 / 0.5)`: the CSS Color 4 space syntax, integer channels. */
export function formatRgb(rgb: Rgb, alpha = 1): string {
  return `rgb(${byte(rgb.r)} ${byte(rgb.g)} ${byte(rgb.b)}${alphaSuffix(alpha)})`
}

/**
 * `hsl(217.2 91.2% 59.8%)`. One decimal: integer HSL cannot reach every 8-bit
 * color, and a second decimal is noise. A gray prints hue 0 rather than an
 * arbitrary angle left over from float error.
 */
export function formatHsl(hsl: Hsl, alpha = 1): string {
  const s = formatNumber(hsl.s, 1)
  const h = s === '0' ? '0' : formatNumber(hsl.h, 1)
  return `hsl(${h} ${s}% ${formatNumber(hsl.l, 1)}%${alphaSuffix(alpha)})`
}

/**
 * `oklch(62.37% 0.1882 259.81)`. Lightness as a percentage, as Tailwind and
 * most design tools write it. Two decimals of L, four of C and two of H keep
 * the printed value within one 8-bit step of the hex it came from. Below that
 * chroma the hue is meaningless, so a gray prints hue 0.
 */
export function formatOklch(oklch: Oklch, alpha = 1): string {
  const c = formatNumber(oklch.c, 4)
  const h = c === '0' ? '0' : formatNumber(oklch.h, 2)
  return `oklch(${formatNumber(oklch.l * 100, 2)}% ${c} ${h}${alphaSuffix(alpha)})`
}

export interface ColorInfo {
  alpha: number
  /** False only for an OKLCH color that sRGB (hex, rgb(), hsl()) cannot show. */
  inGamut: boolean
  /** The sRGB color the hex / rgb / hsl outputs show: the color itself, or its chroma-reduced version. */
  rgb: Rgb
  hsl: Hsl
  /** The color as given (an OKLCH input is not altered), or the OKLCH of an sRGB input. */
  oklch: Oklch
  /** When out of gamut: the same lightness and hue with chroma lowered until sRGB can show it. */
  clipped: Oklch | null
  css: {
    hex: string
    rgb: string
    hsl: string
    oklch: string
    /** `formatOklch(clipped)`, when out of gamut. */
    clippedOklch: string | null
  }
  /** CSS names for this exact color (`aqua` and `cyan` share one). Empty unless opaque. */
  names: readonly string[]
}

/** Every output the converter shows, from one parsed color. */
export function describeColor(color: Color): ColorInfo {
  const alpha = color.alpha
  let rgb: Rgb
  let oklch: Oklch
  let clipped: Oklch | null = null

  if (color.space === 'srgb') {
    rgb = clampRgb(color)
    oklch = rgbToOklch(rgb)
  } else {
    oklch = { l: color.l, c: color.c, h: color.h }
    const direct = oklchToRgb(oklch)
    if (isInGamut(direct)) {
      rgb = clampRgb(direct)
    } else {
      const clip = clipToSrgb(oklch)
      clipped = clip.oklch
      rgb = clip.rgb
    }
  }

  const hex = formatHex(rgb, alpha)
  const names = alpha >= 1 ? namesForHex(hex.slice(1)) : alpha === 0 && hex === '#00000000' ? ['transparent'] : []
  return {
    alpha,
    inGamut: clipped === null,
    rgb,
    hsl: rgbToHsl(rgb),
    oklch,
    clipped,
    css: {
      hex,
      rgb: formatRgb(rgb, alpha),
      hsl: formatHsl(rgbToHsl(rgb), alpha),
      oklch: formatOklch(oklch, alpha),
      clippedOklch: clipped === null ? null : formatOklch(clipped, alpha),
    },
    names,
  }
}
