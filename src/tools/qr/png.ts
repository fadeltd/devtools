/**
 * PNG export. Kept in the shell rather than core because it needs a canvas;
 * the matrix and the pixel scale come from core.
 */
export function renderPng(
  matrix: readonly (readonly boolean[])[],
  scale: number,
  foreground: string,
  background: string,
): Promise<Blob | null> {
  const size = matrix.length
  const pixels = size * scale
  const canvas = document.createElement('canvas')
  canvas.width = pixels
  canvas.height = pixels
  const ctx = canvas.getContext('2d')
  if (ctx === null) return Promise.resolve(null)

  ctx.fillStyle = background
  ctx.fillRect(0, 0, pixels, pixels)
  ctx.fillStyle = foreground
  // Whole-pixel rects per horizontal run, the same runs as the SVG path, so
  // the two downloads are the same image and no edge is anti-aliased.
  matrix.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x++
        continue
      }
      const start = x
      while (x < row.length && row[x]) x++
      ctx.fillRect(start * scale, y * scale, (x - start) * scale, scale)
    }
  })

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
