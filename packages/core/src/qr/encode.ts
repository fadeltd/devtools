import { encode } from 'uqr'

export type Ecc = 'L' | 'M' | 'Q' | 'H'

export const ECC_LEVELS: readonly Ecc[] = ['L', 'M', 'Q', 'H']

/** How much of the symbol can be damaged and still read, for the UI's labels. */
export const ECC_RECOVERY: Readonly<Record<Ecc, string>> = { L: '7%', M: '15%', Q: '25%', H: '30%' }

/** The encoding uqr picks: the densest single mode the whole payload fits. */
export type QrMode = 'numeric' | 'alphanumeric' | 'byte'

/**
 * Characters that fit in a version 40 symbol, from ISO/IEC 18004 table 7. In
 * numeric and alphanumeric mode every character is one ASCII byte, so these
 * are byte limits too. Checked against uqr itself in the tests.
 */
export const CAPACITY: Readonly<Record<QrMode, Readonly<Record<Ecc, number>>>> = {
  numeric: { L: 7089, M: 5596, Q: 3993, H: 3057 },
  alphanumeric: { L: 4296, M: 3391, Q: 2420, H: 1852 },
  byte: { L: 2953, M: 2331, Q: 1663, H: 1273 },
}

export const DEFAULT_BORDER = 4
const MAX_BORDER = 32
// Below two modules, a busy surround blends into the finder patterns.
const MIN_SAFE_BORDER = 2
// From here a phone has to be held close or the code shown big: modules get
// small and the camera's focus starts to matter.
const DENSE_VERSION = 20

export interface QrOptions {
  ecc: Ecc
  /** Quiet zone in modules. The spec asks for 4; scanners struggle below 2. */
  border: number
}

export const DEFAULT_QR_OPTIONS: QrOptions = { ecc: 'M', border: DEFAULT_BORDER }

export interface QrCode {
  ok: true
  /** `matrix[y][x]`, true for a dark module, quiet zone included. */
  matrix: boolean[][]
  /** Width and height of `matrix`: `17 + 4 * version + 2 * border`. */
  size: number
  /** 1 to 40. */
  version: number
  /** Modules across the symbol itself, without the quiet zone. */
  modules: number
  border: number
  ecc: Ecc
  mode: QrMode
  /** UTF-8 length of the payload. */
  bytes: number
  /** Will encode, but may scan badly. */
  warnings: string[]
}

export type QrError =
  | { ok: false; reason: 'empty' | 'invalid'; message: string }
  | { ok: false; reason: 'too-long'; message: string; bytes: number; limit: number; mode: QrMode; ecc: Ecc }

export type QrResult = QrCode | QrError

// The same tests uqr uses to choose a mode, so the capacity check agrees with
// what it will actually encode. No `u` flag: `\d` must stay ASCII-only.
const NUMERIC = /^\d*$/
const ALPHANUMERIC = /^[A-Z0-9 $%*+./:-]*$/

export function detectMode(text: string): QrMode {
  if (NUMERIC.test(text)) return 'numeric'
  if (ALPHANUMERIC.test(text)) return 'alphanumeric'
  return 'byte'
}

// With the `u` flag a surrogate pair is one code point outside this range, so
// only an unpaired half matches.
const LONE_SURROGATE = /[\uD800-\uDFFF]/u

function clampBorder(border: number): number {
  if (!Number.isFinite(border)) return DEFAULT_BORDER
  return Math.min(MAX_BORDER, Math.max(0, Math.round(border)))
}

/**
 * Encode a payload into a module matrix at a fixed ECC level. The level is the
 * user's choice, so uqr's `boostEcc` stays off: the result reports exactly the
 * level that was asked for.
 */
export function encodeQr(payload: string, options: Partial<QrOptions> = {}): QrResult {
  const ecc = options.ecc ?? DEFAULT_QR_OPTIONS.ecc
  const border = clampBorder(options.border ?? DEFAULT_QR_OPTIONS.border)

  if (payload === '') return { ok: false, reason: 'empty', message: 'Nothing to encode.' }
  // uqr converts to UTF-8 through encodeURI, which throws on a lone surrogate;
  // TextEncoder would instead swap it for U+FFFD and encode something else.
  if (LONE_SURROGATE.test(payload)) {
    return { ok: false, reason: 'invalid', message: 'The text contains a broken character (an unpaired surrogate).' }
  }

  const mode = detectMode(payload)
  const bytes = mode === 'byte' ? new TextEncoder().encode(payload).length : payload.length
  const limit = CAPACITY[mode][ecc]
  // Checked up front rather than by catching uqr's error: for a pasted
  // megabyte, uqr would build an eight-million-entry bit array before failing.
  if (bytes > limit) {
    const unit = mode === 'byte' ? 'bytes' : 'characters'
    const hint = ecc === 'L' ? '' : ' A lower error correction level fits more.'
    return {
      ok: false,
      reason: 'too-long',
      message: `Too long for any QR version at error correction ${ecc}: ${bytes} ${unit}, the limit is ${limit}.${hint}`,
      bytes,
      limit,
      mode,
      ecc,
    }
  }

  try {
    const qr = encode(payload, { ecc, border, boostEcc: false })
    const warnings: string[] = []
    if (border < MIN_SAFE_BORDER) {
      warnings.push(`A quiet zone of ${border} module${border === 1 ? '' : 's'} only scans on a plain, light surround. The spec asks for ${DEFAULT_BORDER}.`)
    }
    if (qr.version >= DENSE_VERSION) {
      warnings.push(`Version ${qr.version} is dense. Print or show it large, or shorten the content.`)
    }
    return {
      ok: true,
      matrix: qr.data,
      size: qr.size,
      version: qr.version,
      modules: 17 + 4 * qr.version,
      border,
      ecc,
      mode,
      bytes,
      warnings,
    }
  } catch (err) {
    // Not expected after the checks above, but a library throw must not reach the UI.
    return { ok: false, reason: 'invalid', message: err instanceof Error ? err.message : String(err) }
  }
}
