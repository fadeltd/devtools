/**
 * Vector output. The path string is shared by the download and the live
 * preview, which sets it as a React `d` prop -- the SVG document string itself
 * only ever goes into a Blob, never into the DOM.
 */

export const PIXEL_SIZE_MIN = 64
export const PIXEL_SIZE_MAX = 4096
export const DEFAULT_PIXEL_SIZE = 512

/**
 * One subpath per horizontal run of dark modules, in module units. Merging runs
 * instead of drawing a square per module makes the file several times smaller
 * and leaves no hairline seams between neighbours when a viewer anti-aliases.
 */
export function modulePath(matrix: readonly (readonly boolean[])[]): string {
  const parts: string[] = []
  matrix.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x++
        continue
      }
      const start = x
      while (x < row.length && row[x]) x++
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`)
    }
  })
  return parts.join('')
}

export interface PixelScale {
  /** Whole pixels per module. */
  scale: number
  /** The actual image width and height: `scale * size`. */
  pixels: number
}

/**
 * Snap a requested image width down to a whole number of pixels per module. A
 * fractional scale blurs module edges in a PNG, and blurred edges are what
 * makes a code slow to scan. Never below one pixel per module.
 */
export function pixelScale(target: number, size: number): PixelScale {
  const clamped = Number.isFinite(target) ? Math.min(PIXEL_SIZE_MAX, Math.max(PIXEL_SIZE_MIN, target)) : DEFAULT_PIXEL_SIZE
  const scale = Math.max(1, Math.floor(clamped / size))
  return { scale, pixels: scale * size }
}

export interface SvgOptions {
  /** Already-validated `#rrggbb`, from checkColors. */
  foreground: string
  background: string
  /** Requested width in pixels; snapped by pixelScale. */
  pixelSize: number
}

const COLOR = /^#[0-9a-f]{6}$/i

/**
 * A standalone SVG file: one background rect and exactly one path. Colours are
 * checked again here because they are interpolated into markup; anything but a
 * hex colour is refused rather than escaped.
 */
export function buildSvg(
  matrix: readonly (readonly boolean[])[],
  options: SvgOptions,
): { ok: true; svg: string; pixels: number } | { ok: false; message: string } {
  if (!COLOR.test(options.foreground)) return { ok: false, message: `Invalid foreground colour “${options.foreground}”.` }
  if (!COLOR.test(options.background)) return { ok: false, message: `Invalid background colour “${options.background}”.` }
  const size = matrix.length
  if (size === 0) return { ok: false, message: 'Nothing to draw.' }
  const { pixels } = pixelScale(options.pixelSize, size)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${pixels}" height="${pixels}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="${options.background}"/>` +
    `<path fill="${options.foreground}" d="${modulePath(matrix)}"/>` +
    `</svg>\n`
  return { ok: true, svg, pixels }
}
