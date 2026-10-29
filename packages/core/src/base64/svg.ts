import type { Dimensions } from './snippets.ts'

/** `100`, `100px` or `100.5` -- anything else (em, %, mm) has no fixed pixel size. */
function pixels(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(value)
  if (!m) return undefined
  const n = Number(m[1])
  return n > 0 ? n : undefined
}

function attr(tag: string, name: string): string | undefined {
  // Preceded by whitespace, so `stroke-width` never matches `width`.
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
  return m ? (m[1] ?? m[2]) : undefined
}

/**
 * Intrinsic size of an SVG from its root element. createImageBitmap cannot
 * decode SVG, so this is the only way to size one off the main thread.
 *
 * Uses width/height when both are pixel lengths, else derives the missing
 * side from the viewBox's aspect ratio, else the viewBox itself.
 */
export function svgDimensions(text: string): Dimensions | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (tag === undefined) return null

  const width = pixels(attr(tag, 'width'))
  const height = pixels(attr(tag, 'height'))
  if (width !== undefined && height !== undefined) return { width, height }

  const vb = attr(tag, 'viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (vb?.length !== 4) return null
  const [, , vbW, vbH] = vb as [number, number, number, number]
  if (!(vbW > 0 && vbH > 0)) return null

  if (width !== undefined) return { width, height: (width * vbH) / vbW }
  if (height !== undefined) return { width: (height * vbW) / vbH, height }
  return { width: vbW, height: vbH }
}

/** The root element's sizing attributes, verbatim, for showing what the file declares. */
export interface SvgRoot {
  width: string | null
  height: string | null
  viewBox: string | null
}

/** Raw width, height and viewBox of the root `<svg>`, or null when there is no root element. */
export function svgRoot(text: string): SvgRoot | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (tag === undefined) return null
  return {
    width: attr(tag, 'width')?.trim() ?? null,
    height: attr(tag, 'height')?.trim() ?? null,
    viewBox: attr(tag, 'viewBox')?.trim() ?? null,
  }
}
