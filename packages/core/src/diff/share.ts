import { decodeCompact, encodeCompact, fragmentValue } from '../share/compact.ts'

/**
 * Share links: both sides, compressed into the URL fragment (`#d=1.…`).
 *
 * The fragment is never sent to the server, so this keeps the no-network
 * promise -- but the link *is* the content. It sits in browser history and
 * wherever it is pasted, which is why it is capped and the button says so.
 * The encoding itself lives in `../share`.
 */

/** The fragment key: `#d=<value>`. */
export const SHARE_PARAM = 'd'

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
  return encodeCompact([left, right])
}

/**
 * Read a share link from a location hash (`#d=…`, or the bare value).
 * `null` for anything that is not an intact link this version wrote.
 */
export async function decodeShare(hash: string): Promise<SharedDiff | null> {
  const parsed = await decodeCompact(fragmentValue(hash, SHARE_PARAM), { maxDecodedBytes: MAX_SHARE_DECODED_BYTES })
  if (!Array.isArray(parsed) || parsed.length !== 2) return null
  const [left, right] = parsed as unknown[]
  if (typeof left !== 'string' || typeof right !== 'string') return null
  return { left, right }
}
