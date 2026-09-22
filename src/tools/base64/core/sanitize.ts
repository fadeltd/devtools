export interface Sanitized {
  /** The cleaned base64 payload, ready to decode. */
  payload: string
  mime: string | null
  charset: string | null
  wasDataUri: boolean
  wasUrlSafe: boolean
  wasPercentEncoded: boolean
  strippedWhitespace: number
  hadBom: boolean
  /** True if the data: URI was NOT marked ;base64 (so it is percent-encoded text). */
  plainDataUri: boolean
}

const DATA_URI = /^\s*data:([^;,]*)((?:;[^;,]*)*),/i

/**
 * Clean whatever got pasted, and report every change so the UI can show it.
 *
 * The free tools guess silently, so when a decode fails you cannot tell whether
 * the input was wrong or the tool mangled it. Everything this function does is
 * returned as a flag and surfaced as a dismissible chip.
 */
export function sanitizeBase64Input(raw: string): Sanitized {
  const hadBom = raw.startsWith('﻿')
  let s = hadBom ? raw.slice(1) : raw

  let mime: string | null = null
  let charset: string | null = null
  let wasDataUri = false
  let plainDataUri = false

  const m = DATA_URI.exec(s)
  if (m) {
    wasDataUri = true
    mime = m[1] && m[1] !== '' ? m[1] : null
    const params = m[2] ?? ''
    const cs = /;charset=([^;,]*)/i.exec(params)
    charset = cs?.[1] ?? null
    plainDataUri = !/;base64/i.test(params)
    s = s.slice(m[0].length)
  }

  // Percent-encoded base64 turns up whenever a data URI has been through a
  // URL parameter: %3D is '=', %2B '+', %2F '/'.
  const wasPercentEncoded = /%[0-9a-f]{2}/i.test(s)
  if (wasPercentEncoded) {
    try {
      s = decodeURIComponent(s)
    } catch {
      /* leave as-is; validation will point at the offending character */
    }
  }

  // Strip all whitespace, so PEM (64-col) and MIME (76-col) wrapping just work.
  const before = s.length
  s = s.replace(/\s+/g, '')
  const strippedWhitespace = before - s.length

  const wasUrlSafe = /[-_]/.test(s)

  return {
    payload: s,
    mime,
    charset,
    wasDataUri,
    wasUrlSafe,
    wasPercentEncoded,
    strippedWhitespace,
    hadBom,
    plainDataUri,
  }
}

const STD = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
const URL_SAFE = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=')

export interface InvalidChar {
  index: number
  char: string
  line: number
  column: number
}

/**
 * Locate the first character that is not in the alphabet.
 *
 * Needed because the native `fromBase64` throws a bare SyntaxError with no
 * position, which is useless for pointing at the problem in a large paste.
 */
export function firstInvalidIndex(
  s: string,
  alphabet: 'base64' | 'base64url' | 'auto',
): InvalidChar | null {
  const allowed =
    alphabet === 'base64url' || (alphabet === 'auto' && /[-_]/.test(s)) ? URL_SAFE : STD

  let line = 1
  let column = 1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    if (ch === '\n') {
      line++
      column = 1
      continue
    }
    if (!allowed.has(ch)) return { index: i, char: ch, line, column }
    column++
  }
  return null
}
