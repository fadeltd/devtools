/**
 * What goes inside the QR code. Each builder returns the exact string to
 * encode plus any warnings, or an error -- never a throw, so the UI can render
 * a half-typed form without a try/catch.
 */

export interface PayloadOk {
  ok: true
  payload: string
  /** Things that will encode fine but may not scan the way the user expects. */
  warnings: string[]
}

export interface PayloadError {
  ok: false
  message: string
}

export type PayloadResult = PayloadOk | PayloadError

/** Plain text is encoded as-is: no trimming, since trailing spaces may be meant. */
export function buildText(text: string): PayloadResult {
  if (text === '') return { ok: false, message: 'Type some text to encode.' }
  return { ok: true, payload: text, warnings: [] }
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

// An IPv6 literal has no dot either, but is a perfectly good host.
const isDotless = (host: string) => !host.includes('.') && host !== 'localhost' && !host.startsWith('[')

export interface UrlPayloadOk extends PayloadOk {
  /** True when the input had no scheme and `https://` was put in front. */
  addedScheme: boolean
}

export type UrlPayloadResult = UrlPayloadOk | PayloadError

/**
 * A URL, checked by the platform parser. A bare `example.com` gets `https://`
 * in front, because without a scheme every scanner treats it as plain text and
 * offers to search for it instead of opening it.
 *
 * The user's text is encoded as typed rather than as `URL.href`: the parser
 * would add a trailing slash and rewrite the host, and the QR code should say
 * what the user wrote.
 */
export function buildUrl(input: string): UrlPayloadResult {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, message: 'Type a URL to encode.' }

  // `localhost:3000` and `example.com:8080` match SCHEME but are a host and
  // port. `tel:123` is a real scheme followed by digits, so the test is the
  // shape of the host, not the digits.
  const hostAndPort = /^(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+):\d+(?:[/?#]|$)/i.test(trimmed)
  const hasScheme = SCHEME.test(trimmed) && !hostAndPort
  const candidate = hasScheme ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, message: `“${trimmed}” is not a valid URL.` }
  }

  const warnings: string[] = []
  const scheme = url.protocol.slice(0, -1).toLowerCase()
  if (scheme === 'javascript' || scheme === 'data' || scheme === 'file') {
    warnings.push(`${scheme}: URLs are blocked or ignored by most scanners.`)
  } else if (scheme !== 'http' && scheme !== 'https') {
    warnings.push(`Not an http(s) URL: scanners only open ${scheme}: if an app handles it.`)
  } else if (scheme === 'http') {
    warnings.push('http:// is unencrypted; some phones warn before opening it.')
  }
  if ((scheme === 'http' || scheme === 'https') && isDotless(url.hostname)) {
    warnings.push(`“${url.hostname}” has no dot, so it is not a public host name.`)
  }
  if (/\s/.test(trimmed)) {
    warnings.push('The URL contains spaces; percent-encode them as %20 for reliable scanning.')
  }

  return { ok: true, payload: candidate, warnings, addedScheme: !hasScheme }
}

export type WifiSecurity = 'WPA' | 'WEP' | 'nopass'

export interface WifiInput {
  ssid: string
  password: string
  security: WifiSecurity
  hidden: boolean
}

/**
 * Escape a field of the `WIFI:` scheme. The ZXing spec reserves exactly these
 * five characters; the backslash must go first or it would double-escape the
 * others.
 */
export function escapeWifi(value: string): string {
  return value.replace(/[\\;,:"]/g, (ch) => `\\${ch}`)
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length
const isHex = (s: string) => /^[0-9a-f]+$/i.test(s)

/**
 * `WIFI:T:WPA;S:<ssid>;P:<password>;H:true;;` -- the format iOS and Android
 * cameras join a network from. `T:WPA` covers WPA2 and WPA3 as well; phones
 * negotiate the actual protocol.
 */
export function buildWifi(input: WifiInput): PayloadResult {
  if (input.ssid === '') return { ok: false, message: 'Type the network name (SSID).' }

  const warnings: string[] = []
  // 802.11 caps an SSID at 32 bytes, not characters: an emoji is four.
  if (utf8Length(input.ssid) > 32) {
    warnings.push(`The network name is ${utf8Length(input.ssid)} bytes; Wi-Fi allows at most 32.`)
  }

  const pw = input.password
  if (input.security === 'WPA') {
    if (pw === '') return { ok: false, message: 'WPA needs a password. Choose “None” for an open network.' }
    // A 64-character hex string is a raw pre-shared key, which WPA accepts.
    const rawKey = pw.length === 64 && isHex(pw)
    if (!rawKey && (pw.length < 8 || pw.length > 63)) {
      warnings.push(`A WPA password is 8 to 63 characters; this one is ${pw.length}.`)
    }
  } else if (input.security === 'WEP') {
    if (pw === '') return { ok: false, message: 'WEP needs a key. Choose “None” for an open network.' }
    const valid = pw.length === 5 || pw.length === 13 || ((pw.length === 10 || pw.length === 26) && isHex(pw))
    if (!valid) warnings.push('A WEP key is 5 or 13 characters, or 10 or 26 hex digits.')
  }

  let payload = `WIFI:T:${input.security};S:${escapeWifi(input.ssid)};`
  // An open network has no password field at all; an empty `P:;` confuses some
  // Android scanners into prompting for one.
  if (input.security !== 'nopass') payload += `P:${escapeWifi(pw)};`
  if (input.hidden) payload += 'H:true;'
  payload += ';'

  return { ok: true, payload, warnings }
}
