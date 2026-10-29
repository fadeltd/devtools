export interface Sniffed {
  mime: string
  ext: string
  /** 'magic' means bytes matched a signature; 'text' is a heuristic. */
  confidence: 'magic' | 'text' | 'none'
}

function starts(b: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (b.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (b[offset + i] !== sig[i]) return false
  }
  return true
}

function ascii(b: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...b.subarray(offset, offset + length))
}

const ISO_BMFF_BRANDS: Record<string, { mime: string; ext: string }> = {
  avif: { mime: 'image/avif', ext: 'avif' },
  avis: { mime: 'image/avif', ext: 'avif' },
  heic: { mime: 'image/heic', ext: 'heic' },
  heix: { mime: 'image/heic', ext: 'heic' },
  hevc: { mime: 'image/heic', ext: 'heic' },
  mif1: { mime: 'image/heif', ext: 'heif' },
  msf1: { mime: 'image/heif', ext: 'heif' },
  mp41: { mime: 'video/mp4', ext: 'mp4' },
  mp42: { mime: 'video/mp4', ext: 'mp4' },
  isom: { mime: 'video/mp4', ext: 'mp4' },
  qt: { mime: 'video/quicktime', ext: 'mov' },
}

/** Identify a byte blob by signature, so a missing data: header is not fatal. */
export function sniffMime(bytes: Uint8Array): Sniffed {
  if (bytes.length === 0) return { mime: 'application/octet-stream', ext: 'bin', confidence: 'none' }

  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: 'image/png', ext: 'png', confidence: 'magic' }
  if (starts(bytes, [0xff, 0xd8, 0xff]))
    return { mime: 'image/jpeg', ext: 'jpg', confidence: 'magic' }
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38]))
    return { mime: 'image/gif', ext: 'gif', confidence: 'magic' }
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === 'WEBP')
    return { mime: 'image/webp', ext: 'webp', confidence: 'magic' }
  if (starts(bytes, [0xff, 0x0a]) || starts(bytes, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20]))
    return { mime: 'image/jxl', ext: 'jxl', confidence: 'magic' }
  if (starts(bytes, [0x00, 0x00, 0x01, 0x00]))
    return { mime: 'image/x-icon', ext: 'ico', confidence: 'magic' }
  if (starts(bytes, [0x42, 0x4d]))
    return { mime: 'image/bmp', ext: 'bmp', confidence: 'magic' }

  // ISO-BMFF: 'ftyp' at offset 4, brand at offset 8.
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).trim()
    const hit = ISO_BMFF_BRANDS[brand]
    if (hit) return { ...hit, confidence: 'magic' }
    return { mime: 'application/octet-stream', ext: 'bin', confidence: 'magic' }
  }

  if (starts(bytes, [0x25, 0x50, 0x44, 0x46]))
    return { mime: 'application/pdf', ext: 'pdf', confidence: 'magic' }
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]))
    return { mime: 'application/zip', ext: 'zip', confidence: 'magic' }
  if (starts(bytes, [0x1f, 0x8b]))
    return { mime: 'application/gzip', ext: 'gz', confidence: 'magic' }
  if (starts(bytes, [0x00, 0x61, 0x73, 0x6d]))
    return { mime: 'application/wasm', ext: 'wasm', confidence: 'magic' }

  // SVG has no magic bytes, so it is a text sniff: skip BOM, whitespace, an XML
  // declaration, a DOCTYPE and comments, then look for the root element.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024))
  const stripped = head
    .replace(/^﻿/, '')
    .replace(/^\s+/, '')
    .replace(/^<\?xml[^>]*\?>\s*/i, '')
    .replace(/^<!DOCTYPE[^>]*>\s*/i, '')
    .replace(/^(?:<!--[\s\S]*?-->\s*)+/, '')
  if (/^<svg[\s>]/i.test(stripped)) {
    return { mime: 'image/svg+xml', ext: 'svg', confidence: 'text' }
  }

  return { mime: 'application/octet-stream', ext: 'bin', confidence: 'none' }
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}
