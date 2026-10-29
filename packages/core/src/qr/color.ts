/**
 * Colour checks for the code's two colours. A QR scanner thresholds the image
 * to black and white, so what matters is the luminance gap, not the hue.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * `#rgb` or `#rrggbb`, with or without the `#`, normalised to lowercase
 * `#rrggbb`. No alpha: a translucent code scans differently on every
 * background it is printed over.
 */
export function normalizeHex(input: string): string | null {
  const m = HEX.exec(input.trim())
  if (m === null) return null
  const hex = m[1]!.toLowerCase()
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  return `#${full}`
}

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/** sRGB channel (0-255) to linear light, the WCAG 2 formula. */
function linear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Below this the code tends to fail on phone cameras under poor light. It is
 * stricter than the 3:1 WCAG asks of UI parts, because a scanner has to
 * binarise the image, and a glossy print or dim room eats contrast.
 */
export const MIN_SCAN_CONTRAST = 4

export type ColorCheck =
  | { ok: true; foreground: string; background: string; contrast: number; warnings: string[] }
  | { ok: false; field: 'foreground' | 'background'; message: string }

export function checkColors(foreground: string, background: string): ColorCheck {
  const fg = normalizeHex(foreground)
  if (fg === null) return { ok: false, field: 'foreground', message: `“${foreground}” is not a hex colour like #000000.` }
  const bg = normalizeHex(background)
  if (bg === null) return { ok: false, field: 'background', message: `“${background}” is not a hex colour like #ffffff.` }

  const fgRgb = toRgb(fg)
  const bgRgb = toRgb(bg)
  const contrast = contrastRatio(fgRgb, bgRgb)
  const warnings: string[] = []
  if (contrast < MIN_SCAN_CONTRAST) {
    warnings.push(`Low contrast (${contrast.toFixed(1)}:1). Scanners may fail; aim for ${MIN_SCAN_CONTRAST}:1 or more.`)
  }
  // Checked separately from contrast: white-on-black has full contrast but
  // many scanners only look for dark modules on a light ground.
  if (luminance(fgRgb) > luminance(bgRgb)) {
    warnings.push('Light modules on a dark background: some scanners cannot read an inverted code.')
  }
  return { ok: true, foreground: fg, background: bg, contrast, warnings }
}
