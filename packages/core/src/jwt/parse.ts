import { base64ToBytes } from '../base64/codec.ts'
import { formatValue } from '../json/format.ts'
import { isRawNumber, losslessSupported, parseLossless } from '../json/rawjson.ts'

export type JwsSegment = 'header' | 'payload' | 'signature'
export type JweSegment = 'header' | 'encrypted key' | 'iv' | 'ciphertext' | 'tag'
export type SegmentName = JwsSegment | JweSegment

export interface JwtIssue {
  message: string
  segment?: SegmentName
  /** 0-based character offset into the normalised `token`, where one makes sense. */
  position?: number
}

export interface TokenPart {
  name: SegmentName
  text: string
  /** Offset of the segment's first character in `token`. */
  start: number
}

export interface JsonSegment {
  /** Decoded UTF-8 text; null when the bytes are not valid UTF-8. */
  text: string | null
  /**
   * The parsed value; undefined when `text` is not JSON. A number a double
   * cannot print faithfully is kept as a json `RawNumber` where the runtime
   * supports it, so `pretty` shows the digits that were actually sent.
   */
  value: unknown
  /** Two-space JSON, or the decoded text as-is when it is not JSON. */
  pretty: string
  ok: boolean
}

export interface SignatureInfo {
  bytes: number
  base64url: string
  /** Always false, and spelled out: this tool never holds a key. */
  verified: false
}

export interface ParsedJwt {
  /** The input after trimming and removing any `Bearer` / `Authorization:` prefix. */
  token: string
  kind: 'jws' | 'jwe' | null
  parts: TokenPart[]
  header: JsonSegment | null
  /** Null for a JWE: the payload is ciphertext. */
  payload: JsonSegment | null
  signature: SignatureInfo | null
  /** JWE only: the byte length of each encrypted segment. */
  encrypted: { name: JweSegment; bytes: number }[] | null
  errors: JwtIssue[]
  warnings: JwtIssue[]
}

const JWS_NAMES: readonly JwsSegment[] = ['header', 'payload', 'signature']
const JWE_NAMES: readonly JweSegment[] = ['header', 'encrypted key', 'iv', 'ciphertext', 'tag']

/** Matches `Bearer x`, and a whole `Authorization: Bearer x` line copied from devtools. */
const PREFIX = /^(?:authorization\s*:\s*)?bearer\s+/i

/** /u so a non-BMP character is reported whole, not as half a surrogate pair. */
const NOT_BASE64URL = /[^A-Za-z0-9_-]/u

// fatal: true so invalid UTF-8 is an error, not U+FFFD soup that looks decoded.
const utf8 = new TextDecoder('utf-8', { fatal: true })

const MAX_LOSSY_REPORTS = 20

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !isRawNumber(v)
}

function label(name: SegmentName): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function normalise(input: string): { token: string; notes: JwtIssue[] } {
  let s = input.trim().replace(PREFIX, '')
  // A token copied out of JSON or a shell script often keeps its quotes.
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0]) s = s.slice(1, -1).trim()

  const notes: JwtIssue[] = []
  if (/\s/.test(s)) {
    s = s.replace(/\s+/g, '')
    notes.push({
      message:
        'Removed whitespace inside the token. A JWT never contains any, so it was probably wrapped when it was copied.',
    })
  }
  return { token: s, notes }
}

function segmentCountMessage(n: number): string {
  if (n === 1) {
    return 'Not a JWT: a compact JWT is base64url segments separated by dots (header.payload.signature), and this has no dots.'
  }
  const hint = n === 2 ? ' Is the signature missing? Even an unsigned token ends with a trailing dot.' : ''
  return `Expected 3 segments (a signed JWS) or 5 (an encrypted JWE) separated by dots, but found ${n}.${hint}`
}

/**
 * Strict base64url: only A-Z a-z 0-9 - _ are accepted, and the error points at
 * the first character that is not. The shared decoder maps - and _ but lets +
 * and / through, which would silently accept standard base64, so the alphabet
 * is checked here first. Padding is tolerated with a warning: RFC 7515 forbids
 * it, but refusing to *show* a padded token helps nobody.
 */
function decodeSegment(part: TokenPart, warnings: JwtIssue[]): Uint8Array | JwtIssue {
  const { name, start } = part
  let body = part.text

  const pad = /=+$/.exec(body)
  if (pad !== null) {
    body = body.slice(0, pad.index)
    warnings.push({
      segment: name,
      message: `${label(name)} is padded with "=", which RFC 7515 forbids. Strict libraries will reject this token.`,
      position: start + pad.index,
    })
  }

  const bad = NOT_BASE64URL.exec(body)
  if (bad !== null) {
    const ch = bad[0]
    const position = start + bad.index
    const shown = /\s|\p{C}/u.test(ch) ? `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` : `"${ch}"`
    const hint =
      ch === '+' || ch === '/'
        ? ' This looks like standard base64; a JWT uses base64url, which has - and _ instead of + and /.'
        : ''
    return {
      segment: name,
      message: `${label(name)}: ${shown} at character ${position + 1} is not a base64url character.${hint}`,
      position,
    }
  }

  if (body.length % 4 === 1) {
    return {
      segment: name,
      message: `${label(name)} is truncated: ${body.length} base64url characters cannot encode whole bytes.`,
      position: start + body.length,
    }
  }

  try {
    return base64ToBytes(body, { alphabet: 'base64url', lenient: true })
  } catch (e) {
    return { segment: name, message: `${label(name)}: ${errorMessage(e)}` }
  }
}

/**
 * Distinct integer literals that `JSON.parse` rounds, found by scanning the source with
 * strings skipped -- a numeric-string `sub` is common and is not a problem.
 * The predicate is BigInt(lit) !== BigInt(Number(lit)), never
 * Number.isSafeInteger, which false-positives on 2^53.
 */
export function lossyIntegers(json: string): string[] {
  if (!/\d{16}/.test(json)) return []
  const out = new Set<string>()
  for (const m of json.matchAll(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    const lit = m[0]
    if (!/^-?\d{16,}$/.test(lit)) continue
    const n = Number(lit)
    if (!Number.isFinite(n) || BigInt(lit) !== BigInt(n)) out.add(lit)
    if (out.size === MAX_LOSSY_REPORTS) break
  }
  return [...out]
}

function readJson(
  bytes: Uint8Array,
  name: SegmentName,
  errors: JwtIssue[],
  warnings: JwtIssue[],
): JsonSegment {
  let text: string
  try {
    text = utf8.decode(bytes)
  } catch {
    errors.push({ segment: name, message: `${label(name)} decodes to bytes that are not valid UTF-8 text.` })
    return { text: null, value: undefined, pretty: '', ok: false }
  }

  let value: unknown
  try {
    value = losslessSupported ? parseLossless(text) : JSON.parse(text)
  } catch (e) {
    errors.push({ segment: name, message: `${label(name)} is not valid JSON: ${errorMessage(e)}` })
    return { text, value: undefined, pretty: text, ok: false }
  }

  for (const lit of lossyIntegers(text)) {
    const rounded = String(Number(lit))
    warnings.push({
      segment: name,
      message: losslessSupported
        ? `${label(name)}: ${lit} is too large for a JavaScript number. It is shown as sent, but a JavaScript consumer will read it as ${rounded}.`
        : `${label(name)}: ${lit} is too large for a JavaScript number, and this browser shows it rounded to ${rounded}.`,
    })
  }

  return { text, value, pretty: formatValue(value, { indent: 2, sortKeys: false }), ok: true }
}

const SIGNING_ALG =
  /^(?:(?:HS|RS|ES|PS)(?:256|384|512)|ES256K|EdDSA|Ed25519|Ed448|ML-DSA-(?:44|65|87))$/
const KEY_MANAGEMENT_ALG =
  /^(?:dir|RSA1_5|RSA-OAEP(?:-256|-384|-512)?|A(?:128|192|256)(?:GCM)?KW|ECDH-ES(?:\+A(?:128|192|256)KW)?|PBES2-HS(?:256\+A128|384\+A192|512\+A256)KW)$/

/** JWT, application/jwt, and structured suffixes such as at+jwt or secevent+jwt. JOSE is the generic type. */
const JWT_TYP = /^(?:application\/)?(?:[\w.-]+\+)?jwt$|^(?:application\/)?jose(?:\+json)?$/i

function headerWarnings(h: Record<string, unknown>, kind: 'jws' | 'jwe', sigBytes: number | null): JwtIssue[] {
  const out: JwtIssue[] = []
  const warn = (message: string) => out.push({ segment: 'header', message })
  const alg = h['alg']

  if (alg === undefined) {
    warn('The header has no "alg". Every signed or encrypted JWT must name its algorithm.')
  } else if (typeof alg !== 'string') {
    warn(`"alg" should be a string, but it is ${JSON.stringify(alg)}.`)
  } else if (alg.toLowerCase() === 'none') {
    warn(
      `"alg" is "${alg}": the token is unsigned, so anyone can forge one. Accept it only if you meant to.` +
        (alg === 'none' ? '' : ' Odd casings of "none" have been used to slip past blocklists.'),
    )
    if (kind === 'jws' && sigBytes !== null && sigBytes > 0) {
      warn('"alg" is "none", yet the token carries a signature. Something has been tampered with or mislabelled.')
    }
  } else if (kind === 'jws' && KEY_MANAGEMENT_ALG.test(alg)) {
    warn(`"${alg}" is a key-management algorithm for an encrypted token (JWE), but this token has 3 segments, the shape of a signed one.`)
  } else if (kind === 'jwe' && SIGNING_ALG.test(alg)) {
    warn(`"${alg}" is a signing algorithm, but this token has 5 segments, the shape of an encrypted one (JWE).`)
  }

  if (kind === 'jws' && sigBytes === 0 && typeof alg === 'string' && alg.toLowerCase() !== 'none') {
    warn(`The signature is empty, but "alg" is "${alg}". A verifier will reject this token.`)
  }

  const typ = h['typ']
  if (typ !== undefined && (typeof typ !== 'string' || !JWT_TYP.test(typ))) {
    warn(`"typ" is ${JSON.stringify(typ)}, which is not a JWT type. This may be some other kind of JOSE object.`)
  }

  if (kind === 'jwe' && h['enc'] === undefined) {
    warn('An encrypted token (JWE) must name its content encryption in "enc", and this header does not.')
  } else if (kind === 'jws' && h['enc'] !== undefined) {
    warn('The header has "enc", which only an encrypted token (JWE) uses, but this token has the 3-segment signed shape.')
  }
  return out
}

/** Decode a token's structure. Claims and expiry are `checkClaims`, which needs a clock. */
export function parseJwt(input: string): ParsedJwt {
  const { token, notes } = normalise(input)
  const errors: JwtIssue[] = []
  const warnings: JwtIssue[] = token === '' ? [] : notes
  const result: ParsedJwt = {
    token,
    kind: null,
    parts: [],
    header: null,
    payload: null,
    signature: null,
    encrypted: null,
    errors,
    warnings,
  }
  if (token === '') return result

  const texts = token.split('.')
  if (texts.length !== 3 && texts.length !== 5) {
    errors.push({ message: segmentCountMessage(texts.length) })
    return result
  }

  const kind = texts.length === 3 ? 'jws' : 'jwe'
  const names: readonly SegmentName[] = kind === 'jws' ? JWS_NAMES : JWE_NAMES
  let offset = 0
  const parts = texts.map((text, i): TokenPart => {
    const part = { name: names[i]!, text, start: offset }
    offset += text.length + 1
    return part
  })
  result.kind = kind
  result.parts = parts

  const readJsonPart = (part: TokenPart): JsonSegment | null => {
    if (part.text === '') {
      errors.push({ segment: part.name, message: `${label(part.name)} is empty.`, position: part.start })
      return null
    }
    const bytes = decodeSegment(part, warnings)
    if (!(bytes instanceof Uint8Array)) {
      errors.push(bytes)
      return null
    }
    return readJson(bytes, part.name, errors, warnings)
  }

  const [headerPart, ...rest] = parts
  result.header = readJsonPart(headerPart!)
  if (result.header?.ok === true && !isPlainObject(result.header.value)) {
    errors.push({ segment: 'header', message: 'Header is valid JSON, but not an object.' })
  }

  if (kind === 'jws') {
    const [payloadPart, sigPart] = rest as [TokenPart, TokenPart]
    result.payload = readJsonPart(payloadPart)
    if (result.payload?.ok === true && !isPlainObject(result.payload.value)) {
      warnings.push({
        segment: 'payload',
        message: 'The payload is valid JSON but not an object, so it holds no claims.',
      })
    }
    const sig = decodeSegment(sigPart, warnings)
    if (sig instanceof Uint8Array) result.signature = { bytes: sig.length, base64url: sigPart.text, verified: false }
    else errors.push(sig)
  } else {
    result.encrypted = []
    for (const part of rest) {
      const bytes = decodeSegment(part, warnings)
      if (bytes instanceof Uint8Array) result.encrypted.push({ name: part.name as JweSegment, bytes: bytes.length })
      else errors.push(bytes)
    }
  }

  if (result.header?.ok === true && isPlainObject(result.header.value)) {
    warnings.push(...headerWarnings(result.header.value, kind, result.signature?.bytes ?? null))
  }
  return result
}
