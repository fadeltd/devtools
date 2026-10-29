import { bytesToBase64 } from '../base64/codec.ts'

export const ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const
export type Algorithm = (typeof ALGORITHMS)[number]

/** Output size in bytes. Each is distinct, so a length identifies the algorithm. */
export const DIGEST_LENGTH: Record<Algorithm, number> = {
  'SHA-1': 20,
  'SHA-256': 32,
  'SHA-384': 48,
  'SHA-512': 64,
}

export type DigestFormat = 'hex' | 'HEX' | 'base64' | 'base64url'

const encoder = new TextEncoder()

/**
 * Strings are hashed as UTF-8 -- what `printf %s | shasum` and every server
 * library do. The input is never trimmed or normalised: a hash is over exact
 * bytes, and "helpfully" dropping a trailing newline would make it disagree
 * with the command line in a way nobody could see.
 */
export function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data
}

/**
 * Rejects only where `crypto.subtle` is missing, which in a browser means an
 * insecure context (plain http on a LAN address). Valid input never fails.
 */
export async function digest(algorithm: Algorithm, data: string | Uint8Array): Promise<Uint8Array> {
  const buffer = await crypto.subtle.digest(algorithm, toBytes(data) as Uint8Array<ArrayBuffer>)
  return new Uint8Array(buffer)
}

/** All four at once over one encoding of the input. */
export async function digestAll(data: string | Uint8Array): Promise<Record<Algorithm, Uint8Array>> {
  const bytes = toBytes(data)
  const results = await Promise.all(ALGORITHMS.map((a) => digest(a, bytes)))
  return Object.fromEntries(ALGORITHMS.map((a, i) => [a, results[i]!])) as Record<
    Algorithm,
    Uint8Array
  >
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += HEX[b]
  return out
}

export function formatDigest(bytes: Uint8Array, format: DigestFormat): string {
  switch (format) {
    case 'hex':
      return toHex(bytes)
    case 'HEX':
      return toHex(bytes).toUpperCase()
    case 'base64':
      return bytesToBase64(bytes, { alphabet: 'base64', padding: true })
    case 'base64url':
      return bytesToBase64(bytes, { alphabet: 'base64url', padding: false })
  }
}
