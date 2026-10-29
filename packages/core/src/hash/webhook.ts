import { parseDigestString, timingSafeEqual } from './compare.ts'
import { ALGORITHMS, formatDigest, toHex, type Algorithm } from './digest.ts'
import { hmac, type KeyEncoding } from './hmac.ts'

export type PresetId = 'github' | 'stripe' | 'slack' | 'plain'

export interface Preset {
  id: PresetId
  label: string
  /** Header that carries the signature; null for Plain. */
  header: string | null
  /** What the provider signs with. Only Plain offers a choice. */
  algorithms: readonly Algorithm[]
  /** Whether a timestamp is part of the signed payload. */
  needsTimestamp: boolean
  /** Default replay window in seconds; null when no timestamp is signed. */
  toleranceSeconds: number | null
}

export const PRESETS: Record<PresetId, Preset> = {
  github: {
    id: 'github',
    label: 'GitHub',
    header: 'X-Hub-Signature-256',
    algorithms: ['SHA-256'],
    needsTimestamp: false,
    toleranceSeconds: null,
  },
  stripe: {
    id: 'stripe',
    label: 'Stripe',
    header: 'Stripe-Signature',
    algorithms: ['SHA-256'],
    needsTimestamp: true,
    // The default in Stripe's own libraries.
    toleranceSeconds: 300,
  },
  slack: {
    id: 'slack',
    label: 'Slack',
    header: 'X-Slack-Signature',
    algorithms: ['SHA-256'],
    needsTimestamp: true,
    // Slack's documented "older than five minutes" rule.
    toleranceSeconds: 300,
  },
  plain: {
    id: 'plain',
    label: 'Plain',
    header: null,
    algorithms: ALGORITHMS,
    needsTimestamp: false,
    toleranceSeconds: null,
  },
}

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[]

/** The algorithm actually used: the provider's, unless the preset is Plain. */
export function presetAlgorithm(preset: PresetId, requested: Algorithm): Algorithm {
  const allowed = PRESETS[preset].algorithms
  return allowed.includes(requested) ? requested : allowed[0]!
}

/**
 * The exact string that gets HMAC'd. The body is concatenated untouched: a
 * provider signs the raw request bytes, so a re-serialised or trimmed body is
 * a different message with a different signature.
 */
export function signedPayload(preset: PresetId, body: string, timestamp: string): string {
  switch (preset) {
    case 'stripe':
      return `${timestamp}.${body}`
    case 'slack':
      return `v0:${timestamp}:${body}`
    case 'github':
    case 'plain':
      return body
  }
}

export interface HeaderLine {
  name: string
  value: string
}

/** The header(s) as the provider sends them. Slack's timestamp travels separately. */
export function headerLines(preset: PresetId, hex: string, timestamp: string): HeaderLine[] {
  switch (preset) {
    case 'github':
      return [{ name: 'X-Hub-Signature-256', value: `sha256=${hex}` }]
    case 'stripe':
      return [{ name: 'Stripe-Signature', value: `t=${timestamp},v1=${hex}` }]
    case 'slack':
      return [
        { name: 'X-Slack-Request-Timestamp', value: timestamp },
        { name: 'X-Slack-Signature', value: `v0=${hex}` },
      ]
    case 'plain':
      return []
  }
}

export type ParsedSignature =
  | {
      ok: true
      /** Candidate signatures, still as text; any one matching is a pass. */
      signatures: string[]
      /** Stripe's `t=`, which overrides the timestamp field when present. */
      timestamp?: string
    }
  | { ok: false; message: string }

/** `Stripe-Signature: …` pasted whole, as copied from a request log. */
const HEADER_NAME = /^[\w-]*signature[\w-]*\s*:\s*/i

/**
 * Accepts the whole header line, just its value, or a bare signature. A
 * Stripe header carries several `v1` values while a secret is being rolled;
 * all of them are returned, and unknown schemes (`v0`) are ignored as Stripe's
 * own libraries do.
 */
export function parseSignatureHeader(preset: PresetId, input: string): ParsedSignature {
  const value = input.trim().replace(HEADER_NAME, '').trim()
  if (value === '') return { ok: false, message: 'No signature to check.' }

  if (preset === 'stripe' && value.includes('=') && /(?:^|,)\s*(?:t|v\d+)=/.test(value)) {
    let timestamp: string | undefined
    const signatures: string[] = []
    for (const part of value.split(',')) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      const k = part.slice(0, eq).trim()
      const v = part.slice(eq + 1).trim()
      if (k === 't') timestamp = v
      else if (k === 'v1') signatures.push(v)
    }
    if (timestamp === undefined) {
      return { ok: false, message: 'The Stripe-Signature header has no t= timestamp.' }
    }
    if (!/^\d+$/.test(timestamp)) {
      return { ok: false, message: `t=${timestamp} is not a Unix timestamp in seconds.` }
    }
    if (signatures.length === 0) {
      return { ok: false, message: 'The Stripe-Signature header has no v1= signature.' }
    }
    return { ok: true, signatures, timestamp }
  }

  if (preset === 'github' && /^sha1=/i.test(value)) {
    return {
      ok: false,
      message:
        'That is the legacy X-Hub-Signature (SHA-1). Paste X-Hub-Signature-256, or use Plain with SHA-1.',
    }
  }

  return { ok: true, signatures: [value] }
}

/**
 * Signed age in seconds: positive is in the past. `now` is milliseconds, as
 * `Date.now()` returns, and is a parameter so the check is deterministic.
 */
export function timestampAge(timestamp: string, now: number): number {
  return Math.floor(now / 1000) - Number(timestamp)
}

/**
 * Inclusive at the boundary, and symmetric: a timestamp from the future is as
 * suspect as a stale one (Slack's documented check is an absolute value).
 */
export function withinTolerance(timestamp: string, now: number, toleranceSeconds: number): boolean {
  return Math.abs(timestampAge(timestamp, now)) <= toleranceSeconds
}

export interface WebhookInput {
  preset: PresetId
  /** Honoured for Plain; the other presets use the provider's algorithm. */
  algorithm: Algorithm
  key: string
  keyEncoding: KeyEncoding
  body: string
  /** Unix seconds, as typed. Ignored by presets that sign no timestamp. */
  timestamp: string
}

export type SignResult =
  | {
      ok: true
      algorithm: Algorithm
      signedPayload: string
      signature: Uint8Array
      hex: string
      base64: string
      headers: HeaderLine[]
    }
  | { ok: false; field: 'key' | 'timestamp'; message: string; position?: number }

export async function signWebhook(input: WebhookInput): Promise<SignResult> {
  const preset = PRESETS[input.preset]
  if (preset.needsTimestamp && !/^\d+$/.test(input.timestamp)) {
    return {
      ok: false,
      field: 'timestamp',
      message:
        input.timestamp === ''
          ? `${preset.label} signs a timestamp. Enter one, or press Now.`
          : 'The timestamp must be whole Unix seconds, such as 1700000000.',
    }
  }

  const algorithm = presetAlgorithm(input.preset, input.algorithm)
  const payload = signedPayload(input.preset, input.body, input.timestamp)
  const mac = await hmac(algorithm, input.key, payload, input.keyEncoding)
  if (!mac.ok) {
    return {
      ok: false,
      field: 'key',
      message: mac.message,
      ...(mac.position !== undefined && { position: mac.position }),
    }
  }

  const hex = toHex(mac.bytes)
  return {
    ok: true,
    algorithm,
    signedPayload: payload,
    signature: mac.bytes,
    hex,
    base64: formatDigest(mac.bytes, 'base64'),
    headers: headerLines(input.preset, hex, input.timestamp),
  }
}

export interface VerifyInput extends WebhookInput {
  /** The pasted header line, header value or bare signature. */
  signature: string
  /** Milliseconds since the epoch. */
  now: number
  /** Overrides the preset's window; null disables the timestamp check. */
  toleranceSeconds?: number | null
}

export type Verification =
  | { status: 'match'; timestamp: string | null }
  | { status: 'mismatch'; checked: number; timestamp: string | null }
  /** Outside the replay window. `signatureMatches` says whether that was the only problem. */
  | {
      status: 'stale'
      signatureMatches: boolean
      ageSeconds: number
      toleranceSeconds: number
      timestamp: string
    }
  | { status: 'invalid'; message: string }

/**
 * Recompute and compare, as the receiving server would. For Stripe the HMAC
 * uses the `t` from the pasted header, not the timestamp field: that is what
 * Stripe signed, and checking against anything else would always fail.
 */
export async function verifyWebhook(input: VerifyInput): Promise<Verification> {
  const parsed = parseSignatureHeader(input.preset, input.signature)
  if (!parsed.ok) return { status: 'invalid', message: parsed.message }

  const preset = PRESETS[input.preset]
  const timestamp = preset.needsTimestamp ? (parsed.timestamp ?? input.timestamp) : null
  const signed = await signWebhook({ ...input, timestamp: timestamp ?? '' })
  if (!signed.ok) return { status: 'invalid', message: signed.message }

  let matches = false
  let lastError: string | undefined
  for (const candidate of parsed.signatures) {
    const bytes = parseDigestString(candidate)
    if (!bytes.ok) {
      lastError = bytes.message
      continue
    }
    // No early exit: which candidate matched is not worth a timing signal.
    if (timingSafeEqual(bytes.bytes, signed.signature)) matches = true
  }
  if (!matches && parsed.signatures.length === 1 && lastError !== undefined) {
    return { status: 'invalid', message: `Not a hex or base64 signature: ${lastError}` }
  }

  const tolerance =
    input.toleranceSeconds === undefined ? preset.toleranceSeconds : input.toleranceSeconds
  if (timestamp !== null && tolerance !== null && !withinTolerance(timestamp, input.now, tolerance)) {
    return {
      status: 'stale',
      signatureMatches: matches,
      ageSeconds: timestampAge(timestamp, input.now),
      toleranceSeconds: tolerance,
      timestamp,
    }
  }

  return matches
    ? { status: 'match', timestamp }
    : { status: 'mismatch', checked: parsed.signatures.length, timestamp }
}
