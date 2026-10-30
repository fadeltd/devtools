import { base64ToBytes, bytesToBase64 } from '../base64/codec.ts'

/**
 * Compact, versioned encoding of a JSON value for a URL fragment.
 *
 * Format: `1.<base64url of deflate-raw(JSON)>`. The version prefix lets the
 * shape change later without misreading old links. Decoding is capped,
 * because a crafted link can inflate enormously.
 *
 * A fragment is never sent to the server, so a link built from this keeps
 * the no-network promise -- but the link *is* the content. It sits in
 * browser history and wherever it is pasted, which is why callers cap it
 * and say so.
 */

const VERSION = '1.'

export interface DecodeOptions {
  /** Stop inflating past this many bytes and return null. */
  maxDecodedBytes: number
}

/** `1.<base64url>` for any JSON-serialisable value. */
export async function encodeCompact(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value))
  const packed = await bytesOf(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw')))
  return VERSION + bytesToBase64(packed, { alphabet: 'base64url', padding: false })
}

/**
 * The JSON value inside an `encodeCompact` string, or `null` for anything
 * that is not an intact value this version wrote. Never throws. The value is
 * untrusted: validate its shape before using it.
 */
export async function decodeCompact(text: string, options: DecodeOptions): Promise<unknown> {
  if (!text.startsWith(VERSION)) return null
  try {
    const packed = base64ToBytes(text.slice(VERSION.length), { alphabet: 'base64url', lenient: true })
    const stream = new Blob([packed as Uint8Array<ArrayBuffer>]).stream()
    const json = await bytesOf(
      stream.pipeThrough(new DecompressionStream('deflate-raw')).pipeThrough(capped(options.maxDecodedBytes)),
    )
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)) as unknown
  } catch {
    return null
  }
}

/**
 * The value of `#key=…` in a location hash, or the bare value when `hash`
 * carries no `#key=` prefix.
 */
export function fragmentValue(hash: string, key: string): string {
  const prefix = `#${key}=`
  return hash.startsWith(prefix) ? hash.slice(prefix.length) : hash
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
      if (total > limit) controller.error(new RangeError(`Inflates past ${limit} bytes`))
      else controller.enqueue(chunk)
    },
  })
}
