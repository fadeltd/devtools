import { expose } from 'comlink'
import { bytesToBase64, type EncodeOptions } from './core/codec'
import type { Dimensions } from './core/snippets'
import { svgDimensions } from './core/svg'

export interface Inspected {
  /** Null when only the dimensions were asked for. */
  base64: string | null
  /** Null when the browser cannot decode this format (e.g. HEIC outside Safari). */
  size: Dimensions | null
}

async function measure(blob: Blob, mime: string): Promise<Dimensions | null> {
  if (mime === 'image/svg+xml') {
    // The root element is at the top; no need to read a whole 20 MB SVG.
    return svgDimensions(await blob.slice(0, 64 * 1024).text())
  }
  if (!mime.startsWith('image/')) return null
  try {
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return null
  }
}

/**
 * Encoding a 25 MB file and decoding an image to measure it both take long
 * enough to drop frames, so they happen here. The Blob crosses by structured
 * clone (no copy of the bytes); only the string and the size come back.
 */
const api = {
  async inspect(blob: Blob, mime: string, encode: EncodeOptions | null): Promise<Inspected> {
    const [base64, size] = await Promise.all([
      encode === null ? null : blob.arrayBuffer().then((buf) => bytesToBase64(new Uint8Array(buf), encode)),
      measure(blob, mime),
    ])
    return { base64, size }
  },
}

export type FileApi = typeof api

expose(api)
