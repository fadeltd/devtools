import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { encodeQr } from './encode.ts'
import { buildSvg, modulePath, pixelScale, PIXEL_SIZE_MAX, PIXEL_SIZE_MIN } from './svg.ts'

/** Paint a path made of `M x y h w v1 h-w z` runs back into cells. */
function paint(d: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let i = 0; i < Number(w); i++) grid[Number(y)]![Number(x) + i] = true
  }
  return grid
}

describe('modulePath', () => {
  it('merges horizontal runs', () => {
    expect(modulePath([[true, true, false, true]])).toBe('M0 0h2v1h-2zM3 0h1v1h-1z')
  })

  it('is empty for an all-light matrix', () => {
    expect(
      modulePath([
        [false, false],
        [false, false],
      ]),
    ).toBe('')
  })

  it('paints back exactly the dark modules', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 24 })
          .chain((n) => fc.array(fc.array(fc.boolean(), { minLength: n, maxLength: n }), { minLength: n, maxLength: n })),
        (matrix) => {
          expect(paint(modulePath(matrix), matrix.length)).toEqual(matrix)
        },
      ),
    )
  })
})

describe('pixelScale', () => {
  it('snaps down to whole pixels per module', () => {
    expect(pixelScale(512, 29)).toEqual({ scale: 17, pixels: 493 })
  })

  it('never goes below one pixel per module', () => {
    // A version 40 code with a border is 185 modules: more than the 64 px minimum.
    expect(pixelScale(10, 185)).toEqual({ scale: 1, pixels: 185 })
  })

  it('clamps the request to the allowed range', () => {
    expect(pixelScale(1e9, 21).pixels).toBeLessThanOrEqual(PIXEL_SIZE_MAX)
    expect(pixelScale(0, 21).pixels).toBeGreaterThan(PIXEL_SIZE_MIN - 21)
    expect(pixelScale(Number.NaN, 21).scale).toBeGreaterThan(1)
  })
})

describe('buildSvg', () => {
  const qr = encodeQr('https://example.com', { ecc: 'M', border: 4 })
  if (!qr.ok) throw new Error(qr.message)
  const opts = { foreground: '#000000', background: '#ffffff', pixelSize: 512 }

  it('has exactly one path', () => {
    const r = buildSvg(qr.matrix, opts)
    expect(r.ok && r.svg.match(/<path\b/g)).toHaveLength(1)
  })

  it('has dimensions that match the matrix and the snapped pixel size', () => {
    const r = buildSvg(qr.matrix, opts)
    if (!r.ok) throw new Error(r.message)
    const { pixels } = pixelScale(512, qr.size)
    expect(r.pixels).toBe(pixels)
    expect(r.svg).toContain(`viewBox="0 0 ${qr.size} ${qr.size}"`)
    expect(r.svg).toContain(`width="${pixels}" height="${pixels}"`)
    expect(r.svg).toContain(`<rect width="${qr.size}" height="${qr.size}" fill="#ffffff"/>`)
    expect(r.svg).toContain(`d="${modulePath(qr.matrix)}"`)
  })

  it('refuses anything but a #rrggbb colour, so nothing can break out of the attribute', () => {
    expect(buildSvg(qr.matrix, { ...opts, foreground: 'red' }).ok).toBe(false)
    expect(buildSvg(qr.matrix, { ...opts, background: '#fff"/><script>' }).ok).toBe(false)
  })

  it('refuses an empty matrix', () => {
    expect(buildSvg([], opts).ok).toBe(false)
  })
})
