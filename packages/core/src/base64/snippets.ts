import type { Sniffed } from './magic.ts'

export type OutputForm = 'base64' | 'data-uri' | 'img' | 'css'

export interface Dimensions {
  width: number
  height: number
}

export function toDataUri(mime: string, b64: string): string {
  return `data:${mime};base64,${b64}`
}

function escapeAttr(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** An `<img>` tag as text to copy. Width/height are included when known, so the page does not reflow. */
export function toImgTag(mime: string, b64: string, o: { alt: string; size?: Dimensions | null }): string {
  const size = o.size ? ` width="${o.size.width}" height="${o.size.height}"` : ''
  return `<img src="${toDataUri(mime, b64)}"${size} alt="${escapeAttr(o.alt)}">`
}

export function toCssUrl(mime: string, b64: string): string {
  // The base64 alphabet has no quote or paren, so a quoted url() needs no escaping.
  return `url("${toDataUri(mime, b64)}")`
}

/** Build the chosen output form. Every form but plain base64 requires the standard, padded alphabet. */
export function formatOutput(
  form: OutputForm,
  mime: string,
  b64: string,
  o: { alt: string; size?: Dimensions | null },
): string {
  switch (form) {
    case 'base64':
      return b64
    case 'data-uri':
      return toDataUri(mime, b64)
    case 'img':
      return toImgTag(mime, b64, o)
    case 'css':
      return toCssUrl(mime, b64)
  }
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  wasm: 'application/wasm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
}

/** Browsers and OSes disagree on a few names for the same format. */
const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/vnd.microsoft.icon': 'image/x-icon',
  'image/x-ms-bmp': 'image/bmp',
  'application/x-gzip': 'application/gzip',
}

function canonical(mime: string): string {
  const m = mime.toLowerCase().split(';')[0]!.trim()
  return MIME_ALIASES[m] ?? m
}

function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

/**
 * The type to put in a data: URI. The bytes win over the filename and the OS:
 * a JPEG saved as .png is still a JPEG, and the browser decodes it as one.
 */
export function effectiveMime(declared: string, sniffed: Sniffed): string {
  if (sniffed.confidence !== 'none' && sniffed.mime !== 'application/octet-stream') return sniffed.mime
  if (declared !== '') return canonical(declared)
  return 'application/octet-stream'
}

/**
 * Say so when the name or declared type disagrees with the magic bytes. Only
 * a signature match is trusted -- the SVG sniff is a heuristic, and "unknown"
 * contradicts nothing.
 */
export function mimeMismatch(fileName: string, declared: string, sniffed: Sniffed): string | null {
  if (sniffed.confidence !== 'magic' || sniffed.mime === 'application/octet-stream') return null

  const ext = extOf(fileName)
  const byExt = EXT_MIME[ext]
  if (byExt !== undefined && byExt !== sniffed.mime) {
    return `Named .${ext}, but the bytes are ${sniffed.mime}.`
  }
  if (declared !== '' && canonical(declared) !== sniffed.mime) {
    return `Labelled ${canonical(declared)}, but the bytes are ${sniffed.mime}.`
  }
  return null
}
