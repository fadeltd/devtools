/**
 * Lossless numbers via the native JSON source-text-access API.
 *
 * `JSON.parse`'s reviver receives each primitive's original source text, and
 * `JSON.rawJSON(text)` makes a value that `JSON.stringify` prints verbatim. So a
 * number that a double cannot hold can be carried through format/minify/sort
 * as its literal digits, with no parser dependency and nothing that needs
 * `eval` (lossless-json would work too, but its LosslessNumber objects need
 * the same special-casing in every walker, plus a dependency to vet).
 *
 * A raw value is a frozen, null-prototype object -- so every walker that
 * recurses into objects must check `isRawNumber` first, or it will treat the
 * number as a container with a single `rawJSON` key.
 */

export interface RawNumber {
  readonly rawJSON: string
}

interface NativeRawJson {
  rawJSON(text: string): RawNumber
  isRawJSON(value: unknown): boolean
}

interface ReviverContext {
  source?: string
}

type ContextReviver = (this: unknown, key: string, value: unknown, context?: ReviverContext) => unknown

// TS's ES2023 lib predates the API; read it structurally rather than widen lib.
const native = JSON as unknown as Partial<NativeRawJson>

/** False on browsers without the API (Safari < 18.4); callers fall back. */
export const losslessSupported =
  typeof native.rawJSON === 'function' && typeof native.isRawJSON === 'function'

export function isRawNumber(value: unknown): value is RawNumber {
  return losslessSupported && value !== null && typeof value === 'object' && native.isRawJSON!(value)
}

/** The literal a raw number was written as. */
export function rawNumberText(value: RawNumber): string {
  return value.rawJSON
}

/**
 * Parse strict JSON, keeping every number whose literal a double would print
 * differently -- precision loss (`12345678901234567890`) and pure reformatting
 * (`1.0`, `1e5`, `-9223372036854775808`) alike -- as its source text.
 *
 * Throws exactly when `JSON.parse` would. Must only be called when
 * `losslessSupported`.
 */
export function parseLossless(text: string): unknown {
  return JSON.parse(text, keepLiteral as (key: string, value: unknown) => unknown)
}

const keepLiteral: ContextReviver = (_key, value, context) => {
  if (typeof value !== 'number' || context?.source === undefined) return value
  return String(value) === context.source ? value : native.rawJSON!(context.source)
}
