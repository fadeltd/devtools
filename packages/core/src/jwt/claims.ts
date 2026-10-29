import { isRawNumber, rawNumberText } from '../json/rawjson.ts'
import { isPlainObject, parseJwt, type JwtIssue, type ParsedJwt } from './parse.ts'

export const REGISTERED_CLAIMS = ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'] as const
export type RegisteredClaim = (typeof REGISTERED_CLAIMS)[number]

export const CLAIM_LABELS: Record<RegisteredClaim, string> = {
  iss: 'Issuer',
  sub: 'Subject',
  aud: 'Audience',
  exp: 'Expires',
  nbf: 'Not before',
  iat: 'Issued at',
  jti: 'JWT ID',
}

/**
 * Time-based validity only. 'valid' means "inside the exp/nbf window", never
 * "trustworthy": the signature is not verified. 'unknown' means exp or nbf is
 * present but is not a number, so the window cannot be judged.
 */
export type ValidityStatus = 'expired' | 'not-yet-valid' | 'valid' | 'no-expiry' | 'unknown'

export interface TimeInfo {
  seconds: number
  ms: number
  /** Null when the date is outside what a JS Date can hold (±275,760 years). */
  iso: string | null
  /** Claim minus now: positive is in the future. */
  relativeSeconds: number
  /** "in 2 h 5 min", "3 d 4 h ago", "now". */
  relative: string
}

export interface ClaimRow {
  name: RegisteredClaim
  label: string
  /** The value as text: strings as-is, audiences joined, other JSON stringified. */
  display: string
  /** Set for exp, nbf and iat when they are numbers. */
  time: TimeInfo | null
}

export interface ClaimOptions {
  /** Milliseconds since the epoch, i.e. Date.now(). A parameter so tests are deterministic. */
  now: number
  /** Leeway applied to exp and nbf, as most verifiers allow. Default 0. */
  clockSkewSeconds?: number
}

export interface ClaimCheck {
  claims: ClaimRow[]
  status: ValidityStatus
  warnings: JwtIssue[]
}

export interface JwtResult extends ParsedJwt {
  claims: ClaimRow[]
  /** Null when there are no claims to judge: a JWE, or an unreadable payload. */
  status: ValidityStatus | null
}

const MAX_DATE_MS = 8.64e15
/** Seconds past year 5138: such a NumericDate is almost certainly milliseconds. */
const MILLIS_THRESHOLD = 1e11
const FAR_FUTURE_SECONDS = 10 * 365 * 86_400

const UNITS = [
  ['y', 365 * 86_400],
  ['d', 86_400],
  ['h', 3_600],
  ['min', 60],
  ['s', 1],
] as const

/** Two units at most: "3 d 4 h" reads faster than "3 d 4 h 12 min 9 s". */
export function formatRelative(deltaSeconds: number): string {
  let rest = Math.floor(Math.abs(deltaSeconds))
  if (rest < 1) return 'now'
  const first = UNITS.findIndex(([, size]) => rest >= size)
  const parts: string[] = []
  for (const [unit, size] of UNITS.slice(first, first + 2)) {
    const n = Math.floor(rest / size)
    rest -= n * size
    if (n > 0) parts.push(`${n} ${unit}`)
  }
  const text = parts.join(' ')
  return deltaSeconds > 0 ? `in ${text}` : `${text} ago`
}

/** NumericDate is seconds, and RFC 7519 allows fractions. */
function numericValue(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (isRawNumber(v)) {
    const n = Number(rawNumberText(v))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'an array'
  if (typeof v === 'string') return `the string ${JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v)}`
  return `a ${typeof v}`
}

function display(v: unknown): string {
  if (typeof v === 'string') return v
  if (isRawNumber(v)) return rawNumberText(v)
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(', ')
  return JSON.stringify(v) ?? String(v)
}

function timeInfo(seconds: number, nowSeconds: number): TimeInfo {
  const ms = seconds * 1000
  const relativeSeconds = seconds - nowSeconds
  return {
    seconds,
    ms,
    iso: Math.abs(ms) <= MAX_DATE_MS ? new Date(ms).toISOString() : null,
    relativeSeconds,
    relative: formatRelative(relativeSeconds),
  }
}

export function checkClaims(payload: Record<string, unknown>, o: ClaimOptions): ClaimCheck {
  const nowSeconds = o.now / 1000
  const skew = Math.max(0, o.clockSkewSeconds ?? 0)
  const warnings: JwtIssue[] = []
  const warn = (message: string) => warnings.push({ segment: 'payload', message })
  const has = (k: string) => Object.hasOwn(payload, k)

  const claims: ClaimRow[] = []
  const times: Partial<Record<'exp' | 'nbf' | 'iat', number>> = {}
  let unreadableWindow = false

  for (const name of REGISTERED_CLAIMS) {
    if (!has(name)) continue
    const raw = payload[name]
    let time: TimeInfo | null = null

    if (name === 'exp' || name === 'nbf' || name === 'iat') {
      const seconds = numericValue(raw)
      if (seconds === null) {
        warn(`"${name}" is ${describe(raw)}, not a NumericDate (seconds since 1970), so it cannot be checked.`)
        if (name !== 'iat') unreadableWindow = true
      } else {
        times[name] = seconds
        time = timeInfo(seconds, nowSeconds)
        if (Math.abs(seconds) >= MILLIS_THRESHOLD) {
          const when = time.iso === null ? 'beyond any date a computer can hold' : `in the year ${new Date(time.ms).getUTCFullYear()}`
          warn(`"${name}" looks like milliseconds. NumericDate is seconds, so as written it is ${when}.`)
        }
      }
    } else if (name === 'aud') {
      const ok = typeof raw === 'string' || (Array.isArray(raw) && raw.every((x) => typeof x === 'string'))
      if (!ok) warn(`"aud" should be a string or an array of strings, but it is ${describe(raw)}.`)
    } else if (typeof raw !== 'string') {
      warn(`"${name}" should be a string, but it is ${describe(raw)}.`)
    }

    claims.push({ name, label: CLAIM_LABELS[name], display: display(raw), time })
  }

  const { exp, nbf, iat } = times
  if (!has('exp')) {
    warn('There is no "exp" claim, so this token never expires.')
  } else if (exp !== undefined && exp - nowSeconds > FAR_FUTURE_SECONDS && exp < MILLIS_THRESHOLD) {
    warn(`"exp" is ${formatRelative(exp - nowSeconds).replace(/^in /, '')} away. A bearer token that lives that long is a standing risk if it leaks.`)
  }
  if (iat !== undefined && iat - skew > nowSeconds) {
    warn(`"iat" is ${formatRelative(iat - nowSeconds)}: the token claims to be issued in the future. The issuer's clock may be ahead.`)
  }
  if (exp !== undefined && iat !== undefined && exp < iat) {
    warn('"exp" is earlier than "iat": the token expired before it was issued.')
  }

  // RFC 7519: now must be BEFORE exp, and AT OR AFTER nbf. Skew widens both edges.
  let status: ValidityStatus
  if (unreadableWindow) status = 'unknown'
  else if (exp !== undefined && nowSeconds >= exp + skew) status = 'expired'
  else if (nbf !== undefined && nowSeconds + skew < nbf) status = 'not-yet-valid'
  else if (exp === undefined) status = 'no-expiry'
  else status = 'valid'

  return { claims, status, warnings }
}

/** Attach claims and a validity status to an already-parsed token. */
export function withClaims(parsed: ParsedJwt, o: ClaimOptions): JwtResult {
  const value = parsed.payload?.value
  if (parsed.kind !== 'jws' || parsed.payload?.ok !== true || !isPlainObject(value)) {
    return { ...parsed, claims: [], status: null }
  }
  const check = checkClaims(value, o)
  return { ...parsed, claims: check.claims, status: check.status, warnings: [...parsed.warnings, ...check.warnings] }
}

/**
 * Decode a compact JWT: header, payload, signature size, registered claims and
 * a time-based status. Never throws; bad input comes back in `errors`.
 * Nothing is verified -- there is no key here to verify with.
 */
export function decodeJwt(input: string, o: ClaimOptions): JwtResult {
  return withClaims(parseJwt(input), o)
}
