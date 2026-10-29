import { base64ToBytes, bytesToBase64 } from '../base64/codec.ts'

/**
 * Share links: both sides, compressed into the URL fragment.
 *
 * The fragment is never sent to the server, so this keeps the no-network
 * promise -- but the link *is* the content. It sits in browser history and
 * wherever it is pasted, which is why it is capped and the button says so.
 *
 * Format: `1.<base64url of deflate-raw(JSON [left, right])>`. The version
 * prefix lets the shape change later without misreading old links.
 */

/** The fragment key: `#d=<value>`. */
export const SHARE_PARAM = 'd'
const VERSION = '1.'

/** Encoded length past which no link is offered. Survives chat apps and trackers. */
export const MAX_SHARE_CHARS = 8000
/** A crafted link can inflate enormously; stop reading well before that hurts. */
export const MAX_SHARE_DECODED_BYTES = 2_000_000

export interface SharedDiff {
  left: string
  right: string
}

/** The fragment value (without `#d=`) for these two sides. */
export async function encodeShare(left: string, right: string): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify([left, right]))
  const packed = await bytesOf(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw')))
  return VERSION + bytesToBase64(packed, { alphabet: 'base64url', padding: false })
}

/**
 * Read a share link from a location hash (`#d=…`, or the bare value).
 * `null` for anything that is not an intact link this version wrote.
 */
export async function decodeShare(hash: string): Promise<SharedDiff | null> {
  const value = hash.startsWith(`#${SHARE_PARAM}=`) ? hash.slice(SHARE_PARAM.length + 2) : hash
  if (!value.startsWith(VERSION)) return null
  try {
    const packed = base64ToBytes(value.slice(VERSION.length), { alphabet: 'base64url', lenient: true })
    const stream = new Blob([packed as Uint8Array<ArrayBuffer>]).stream()
    const json = await bytesOf(
      stream.pipeThrough(new DecompressionStream('deflate-raw')).pipeThrough(capped(MAX_SHARE_DECODED_BYTES)),
    )
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [left, right] = parsed as unknown[]
    if (typeof left !== 'string' || typeof right !== 'string') return null
    return { left, right }
  } catch {
    return null
  }
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Passes bytes through, erroring -- and so cancelling the source -- once past `limit`. */
function capped(limit: number): TransformStream<Uint8Array, Uint8Array> {
  let total = 0
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.length
      if (total > limit) controller.error(new RangeError(`Share link inflates past ${limit} bytes`))
      else controller.enqueue(chunk)
    },
  })
}
