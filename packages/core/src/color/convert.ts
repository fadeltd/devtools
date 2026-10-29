/** sRGB, gamma-encoded, each channel 0–1. Out-of-gamut values may exceed that range. */
export interface Rgb {
  r: number
  g: number
  b: number
}

/** Hue in degrees [0, 360); saturation and lightness 0–100. */
export interface Hsl {
  h: number
  s: number
  l: number
}

/** Lightness 0–1, chroma ≥ 0 (about 0.37 at most inside sRGB), hue in degrees [0, 360). */
export interface Oklch {
  l: number
  c: number
  h: number
}

export interface Oklab {
  l: number
  a: number
  b: number
}

/**
 * A parsed color. sRGB and OKLCH are kept apart because OKLCH can name colors
 * sRGB cannot show; converting at parse time would lose the "out of gamut"
 * fact the converter has to report. HSL is always inside sRGB, so it is
 * converted to sRGB as soon as it is read.
 */
export type Color =
  | ({ space: 'srgb'; alpha: number } & Rgb)
  | ({ space: 'oklch'; alpha: number } & Oklch)

export function normalizeHue(h: number): number {
  const r = h % 360
  // `+ 0` folds -0 into 0 so a hue never prints as "-0".
  return (r < 0 ? r + 360 : r) + 0
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

// sRGB transfer function (IEC 61966-2-1). Extended to negative values by
// mirroring, so out-of-gamut colors survive the round trip instead of being
// flattened before the gamut check has seen them.
export function srgbToLinear(c: number): number {
  const a = Math.abs(c)
  const v = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4
  return Math.sign(c) * v
}

export function linearToSrgb(c: number): number {
  const a = Math.abs(c)
  const v = a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055
  return Math.sign(c) * v
}

// Björn Ottosson's published OKLab matrices (bottosson.github.io/posts/oklab):
// linear sRGB → LMS → cube root → OKLab, and the exact inverse.
export function linearRgbToOklab(r: number, g: number, b: number): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

export function oklabToLinearRgb({ l: L, a, b }: Oklab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  }
}

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lab = linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b))
  const c = Math.hypot(lab.a, lab.b)
  return { l: lab.l, c, h: normalizeHue((Math.atan2(lab.b, lab.a) * 180) / Math.PI) }
}

/** Unclamped: an out-of-gamut OKLCH color comes back with channels outside 0–1. */
export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180
  const lin = oklabToLinearRgb({ l, a: c * Math.cos(rad), b: c * Math.sin(rad) })
  return { r: linearToSrgb(lin.r), g: linearToSrgb(lin.g), b: linearToSrgb(lin.b) }
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l: l * 100 }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: normalizeHue(h * 60), s: s * 100, l: l * 100 }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  // The CSS Color 4 reference algorithm (§7.1).
  const sat = s / 100
  const light = l / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = sat * Math.min(light, 1 - light)
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return { r: f(0), g: f(8), b: f(4) }
}

/**
 * How far outside 0–1 a channel may stray and still count as inside sRGB.
 *
 * One 8-bit step. The oklch() this module prints for a hex color is rounded,
 * and reading it back can land up to ~0.8 of a step outside the sRGB cube
 * (measured over the whole cube). Without this slack, pasting our own output
 * back in would raise an out-of-gamut warning about a difference no hex,
 * rgb() or hsl() could show anyway.
 */
export const GAMUT_EPSILON = 1 / 255

export function isInGamut({ r, g, b }: Rgb, epsilon = GAMUT_EPSILON): boolean {
  const ok = (x: number) => x >= -epsilon && x <= 1 + epsilon
  return ok(r) && ok(g) && ok(b)
}

export function clampRgb({ r, g, b }: Rgb): Rgb {
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) }
}

/**
 * Bring an OKLCH color inside sRGB by lowering chroma alone, so lightness and
 * hue (what a designer picked) stay put and only the saturation gives. A
 * binary search on chroma: the in-gamut region along a line of constant L and
 * h runs from c = 0 (a gray, always inside for 0 ≤ L ≤ 1) up to the boundary.
 */
export function clipToSrgb(color: Oklch): { oklch: Oklch; rgb: Rgb } {
  const l = clamp01(color.l)
  const h = color.h
  const direct = oklchToRgb({ l, c: color.c, h })
  if (isInGamut(direct)) return { oklch: { l, c: color.c, h }, rgb: clampRgb(direct) }

  let lo = 0
  let hi = color.c
  // 24 halvings take 0.4 of chroma below 1e-7, far under a printable digit.
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (isInGamut(oklchToRgb({ l, c: mid, h }), 0)) lo = mid
    else hi = mid
  }
  return { oklch: { l, c: lo, h }, rgb: clampRgb(oklchToRgb({ l, c: lo, h })) }
}

/** Any parsed color as sRGB, with no gamut handling: channels may fall outside 0–1. */
export function toRgbUnclamped(color: Color): Rgb {
  return color.space === 'srgb' ? { r: color.r, g: color.g, b: color.b } : oklchToRgb(color)
}
