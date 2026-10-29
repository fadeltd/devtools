import { isRawNumber, rawNumberText } from '../json/rawjson.ts'

/**
 * How wide an integer is, which is what decides `int64` vs `uint64` in Go and
 * whether a JS `number` can hold it exactly.
 */
export type IntRange = 'safe' | 'int64' | 'uint64' | 'big'

export interface FieldShape {
  shape: Shape
  /** How many of the object's samples had this key. Fewer than all = optional. */
  count: number
}

export interface ObjectShape {
  /** A Map, never a plain object: `__proto__` and `constructor` are real keys here. */
  fields: Map<string, FieldShape>
  samples: number
}

export interface ArrayShape {
  /** Every element of every sample, merged. Still empty if only `[]` was seen. */
  items: Shape
}

/**
 * Everything one position in the JSON was seen holding, across all samples.
 * A kind is at most one slot, so merging two samples is per-kind and a union
 * is simply more than one slot being set.
 */
export interface Shape {
  null: boolean
  boolean: boolean
  string: boolean
  /** The widest integer seen, or null if none. */
  integer: IntRange | null
  /** A non-integer number was seen (`1.5`, `1.0`, `1e5`). */
  number: boolean
  array: ArrayShape | null
  object: ObjectShape | null
  /** Nested past the depth cap; nothing is known. */
  unknown: boolean
}

/** Past this, shapes are `unknown`, so a hostile nesting can't overflow the stack. */
export const MAX_DEPTH = 200

export function emptyShape(): Shape {
  return {
    null: false,
    boolean: false,
    string: false,
    integer: null,
    number: false,
    array: null,
    object: null,
    unknown: false,
  }
}

/** True when nothing at all was observed, e.g. the items of `[]`. */
export function isEmptyShape(s: Shape): boolean {
  return (
    !s.null &&
    !s.boolean &&
    !s.string &&
    s.integer === null &&
    !s.number &&
    s.array === null &&
    s.object === null &&
    !s.unknown
  )
}

const RANK: Record<IntRange, number> = { safe: 0, int64: 1, uint64: 2, big: 3 }

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n
const UINT64_MAX = 2n ** 64n - 1n

function rangeOf(n: bigint): IntRange {
  if (n >= -MAX_SAFE && n <= MAX_SAFE) return 'safe'
  if (n >= INT64_MIN && n <= INT64_MAX) return 'int64'
  if (n >= 0n && n <= UINT64_MAX) return 'uint64'
  return 'big'
}

function widen(shape: Shape, range: IntRange): void {
  if (shape.integer === null || RANK[range] > RANK[shape.integer]) shape.integer = range
}

export interface InferResult {
  shape: Shape
  /** Where the depth cap was first hit, as a path, or null. */
  truncatedAt: string | null
}

/**
 * Infer one shape from any number of samples (one per document, or one per
 * NDJSON line). Values may contain `RawNumber`s from `parseLossless`, which is
 * how `1.0` is told apart from `1` and how a 20-digit id keeps its width.
 */
export function inferShape(samples: readonly unknown[]): InferResult {
  const root = emptyShape()
  const state = { truncatedAt: null as string | null }
  for (const sample of samples) observe(root, sample, 0, '', state)
  return { shape: root, truncatedAt: state.truncatedAt }
}

function observe(
  shape: Shape,
  value: unknown,
  depth: number,
  path: string,
  state: { truncatedAt: string | null },
): void {
  if (value === null) {
    shape.null = true
    return
  }
  switch (typeof value) {
    case 'boolean':
      shape.boolean = true
      return
    case 'string':
      shape.string = true
      return
    case 'number':
      // Not raw, so String(value) is the literal (when parsed losslessly):
      // `1e+21` was written with an exponent, so it is a float, not an integer.
      if (Number.isInteger(value) && !String(value).includes('e')) widen(shape, rangeOf(BigInt(value)))
      else shape.number = true
      return
  }
  if (isRawNumber(value)) {
    const literal = rawNumberText(value)
    if (/[.eE]/.test(literal)) shape.number = true
    else widen(shape, rangeOf(BigInt(literal)))
    return
  }
  if (typeof value !== 'object') return

  if (depth >= MAX_DEPTH) {
    shape.unknown = true
    state.truncatedAt ??= path === '' ? '.' : path
    return
  }

  if (Array.isArray(value)) {
    shape.array ??= { items: emptyShape() }
    const items = shape.array.items
    for (const el of value) observe(items, el, depth + 1, `${path}[]`, state)
    return
  }

  shape.object ??= { fields: new Map(), samples: 0 }
  const obj = shape.object
  obj.samples++
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    let field = obj.fields.get(key)
    if (field === undefined) {
      field = { shape: emptyShape(), count: 0 }
      obj.fields.set(key, field)
    }
    field.count++
    observe(field.shape, record[key], depth + 1, `${path}${pathKey(key)}`, state)
  }
}

/** A jq-style path step: `.name`, or `."odd key"` when it isn't an identifier. */
export function pathKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `.${key}` : `.${JSON.stringify(key)}`
}
