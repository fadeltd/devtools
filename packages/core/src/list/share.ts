import { decodeCompact, encodeCompact, fragmentValue } from '../share/compact.ts'
import { CASE_LABELS, isOpKind, type Step } from './ops.ts'
import type { BlankPolicy, CaseTarget, LineTest, Op, SortMode } from './types.ts'

/**
 * Share links for a pipeline: the steps, compressed into the URL fragment
 * (`#p=1.…`). Never the input text.
 *
 * A fragment, not a query string: a query string is sent to the server and
 * lands in its logs, and a pipeline can carry user data -- a filter pattern,
 * a whole set-operation list.
 *
 * A link is untrusted input. Everything in it goes through `parseOp`, which
 * rebuilds each op field by field and rejects the whole link on the first bad
 * value, so nothing unvalidated ever reaches `runPipeline`. The numeric bounds
 * are the ones where a crafted value would hang or exhaust memory (a pad
 * width of 1e9, a chunk size of 1e-9), not a second opinion on taste.
 */

/** The fragment key: `#p=<value>`. */
export const PIPELINE_PARAM = 'p'

/** Encoded length past which no link is offered. Same as diff: survives chat apps and trackers. */
export const MAX_PIPELINE_CHARS = 8000
/** A crafted link can inflate enormously; stop reading well before that hurts. */
export const MAX_PIPELINE_DECODED_BYTES = 1_000_000

/** More steps than anyone builds by hand. */
export const MAX_SHARED_STEPS = 64
/** Patterns, needles, separators, prefixes. */
export const MAX_FIELD_CHARS = 2000
/** The set-operation list, the one field that is meant to hold data. */
export const MAX_LIST_CHARS = 500_000
/** `padStart` past this allocates per line for nothing anyone wants. */
export const MAX_PAD = 1000

/** The payload version, independent of the codec's own `1.` prefix. */
const PAYLOAD_VERSION = 1

/** A step as it travels in a link: no id, which the receiver assigns. */
export type SharedStep = Pick<Step, 'op' | 'enabled'>

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A string at most `max` UTF-16 units long, or undefined. */
function str(v: unknown, max = MAX_FIELD_CHARS): string | undefined {
  return typeof v === 'string' && v.length <= max ? v : undefined
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function int(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined
}

function oneOf<const T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

/** A BCP 47 tag `Intl` accepts. A bad one would only fail the step, but it never needs to travel. */
function locale(v: unknown): string | undefined {
  const s = str(v, 64)
  if (s === undefined || s === '') return undefined
  try {
    return Intl.getCanonicalLocales(s).length === 1 ? s : undefined
  } catch {
    return undefined
  }
}

const SORT_MODES = ['codepoint', 'locale', 'natural', 'length', 'random'] as const satisfies readonly SortMode[]
const BLANK_POLICIES = ['keep', 'first', 'last', 'drop'] as const satisfies readonly BlankPolicy[]
const CASE_TARGETS = Object.keys(CASE_LABELS) as CaseTarget[]
const DEDUPE_OUTPUTS = ['unique', 'duplicates-only', 'unique-only', 'with-counts'] as const
const SET_OPS = ['union', 'intersection', 'difference', 'symmetric-difference'] as const
const FORMS = ['NFC', 'NFD', 'NFKC', 'NFKD'] as const
const MAX_INDEX = Number.MAX_SAFE_INTEGER

/**
 * The fields as given when every one parsed, else `null` -- each parser above
 * returns `undefined` for a bad value. Saves a guard per field below.
 */
function all<T extends Obj>(fields: T): { [K in keyof T]: Exclude<T[K], undefined> } | null {
  for (const v of Object.values(fields)) if (v === undefined) return null
  return fields as { [K in keyof T]: Exclude<T[K], undefined> }
}

function parseTest(v: unknown): LineTest | null {
  if (!isObj(v)) return null
  switch (v.t) {
    case 'regex':
      return all({ t: 'regex' as const, source: str(v.source), flags: str(v.flags, 16) })
    case 'contains':
      return all({ t: 'contains' as const, needle: str(v.needle), ci: bool(v.ci) })
    case 'blank':
      return { t: 'blank' }
    case 'index':
      return all({ t: 'index' as const, ranges: str(v.ranges) })
    case 'duplicate':
      return { t: 'duplicate' }
    default:
      return null
  }
}

/**
 * Rebuild one op from an untrusted value: every field checked, unknown fields
 * dropped, `null` on anything malformed. Never throws.
 */
export function parseOp(v: unknown): Op | null {
  if (!isObj(v) || typeof v.kind !== 'string' || !isOpKind(v.kind)) return null

  switch (v.kind) {
    case 'sort': {
      const op = all({
        kind: 'sort' as const,
        order: oneOf(v.order, ['asc', 'desc']),
        mode: oneOf(v.mode, SORT_MODES),
        caseSensitive: bool(v.caseSensitive),
        blanks: oneOf(v.blanks, BLANK_POLICIES),
      })
      return op && withOptional(op, 'locale', v.locale, locale)
    }
    case 'dedupe':
      return all({
        kind: 'dedupe' as const,
        caseSensitive: bool(v.caseSensitive),
        trimKey: bool(v.trimKey),
        keep: oneOf(v.keep, ['first', 'last']),
        output: oneOf(v.output, DEDUPE_OUTPUTS),
      })
    case 'shuffle': {
      const op = all({ kind: 'shuffle' as const, source: oneOf(v.source, ['crypto', 'seeded']) })
      return op && withOptional(op, 'seed', v.seed, (s) => int(s, 0, 0xffff_ffff))
    }
    case 'reverse':
      return { kind: 'reverse' }
    case 'case': {
      const op = all({ kind: 'case' as const, target: oneOf(v.target, CASE_TARGETS) })
      return op && withOptional(op, 'locale', v.locale, locale)
    }
    case 'affix':
      return all({
        kind: 'affix' as const,
        prefix: str(v.prefix),
        suffix: str(v.suffix),
        skipBlank: bool(v.skipBlank),
      })
    case 'filter': {
      const test = parseTest(v.test)
      const op = all({ kind: 'filter' as const, action: oneOf(v.action, ['keep', 'remove']) })
      return op && test && { ...op, test }
    }
    case 'number': {
      const padChar = str(v.padChar, 2)
      return all({
        kind: 'number' as const,
        start: finite(v.start),
        step: finite(v.step),
        pad: int(v.pad, 0, MAX_PAD),
        // One code point (the UI keeps only the last one typed), or none.
        padChar: padChar !== undefined && [...padChar].length <= 1 ? padChar : undefined,
        separator: str(v.separator),
        position: oneOf(v.position, ['prefix', 'suffix']),
        skipBlank: bool(v.skipBlank),
      })
    }
    case 'wrap':
      return all({
        kind: 'wrap' as const,
        width: finite(v.width),
        breakWords: bool(v.breakWords),
        preserveIndent: bool(v.preserveIndent),
      })
    case 'join': {
      const op = all({ kind: 'join' as const, separator: str(v.separator) })
      // A fractional or tiny chunk size would step through the lines forever.
      return op && withOptional(op, 'chunkSize', v.chunkSize, (n) => int(n, 1, MAX_INDEX))
    }
    case 'split': {
      const by = v.by
      if (!isObj(by)) return null
      if (by.t === 'literal') {
        const s = str(by.s)
        return s === undefined ? null : { kind: 'split', by: { t: 'literal', s } }
      }
      if (by.t === 'regex') {
        const parsed = all({ t: 'regex' as const, source: str(by.source), flags: str(by.flags, 16) })
        return parsed && { kind: 'split', by: parsed }
      }
      return null
    }
    case 'trim':
      return all({
        kind: 'trim' as const,
        leading: bool(v.leading),
        trailing: bool(v.trailing),
        collapseInternal: bool(v.collapseInternal),
      })
    case 'normalize':
      return all({ kind: 'normalize' as const, form: oneOf(v.form, FORMS) })
    case 'setop':
      return all({
        kind: 'setop' as const,
        op: oneOf(v.op, SET_OPS),
        other: str(v.other, MAX_LIST_CHARS),
        caseSensitive: bool(v.caseSensitive),
        bag: bool(v.bag),
      })
    case 'slice': {
      const op = all({ kind: 'slice' as const, from: finite(v.from) })
      return op && withOptional(op, 'to', v.to, finite)
    }
  }
}

/**
 * Add an optional field: absent stays absent, present must parse. A present
 * but invalid value rejects the op rather than being silently dropped, so a
 * link never runs as something other than what was shared.
 */
function withOptional<T extends object, K extends string, V>(
  op: T,
  key: K,
  raw: unknown,
  parse: (v: unknown) => V | undefined,
): (T & { [P in K]?: V }) | null {
  if (raw === undefined) return op
  const value = parse(raw)
  return value === undefined ? null : { ...op, [key]: value }
}

/** Every op in an untrusted array, or `null` if the array or any op is malformed. */
export function parseOps(value: unknown): Op[] | null {
  if (!Array.isArray(value) || value.length > MAX_SHARED_STEPS) return null
  const out: Op[] = []
  for (const item of value) {
    const op = parseOp(item)
    if (op === null) return null
    out.push(op)
  }
  return out
}

/**
 * The steps inside a decoded payload (`{ v: 1, steps: [{ op, on }] }`), or
 * `null` for anything else -- including a newer payload version and an empty
 * pipeline, which is nothing to load.
 */
export function parseSharedSteps(value: unknown): SharedStep[] | null {
  if (!isObj(value) || value.v !== PAYLOAD_VERSION) return null
  const raw = value.steps
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SHARED_STEPS) return null
  const out: SharedStep[] = []
  for (const item of raw) {
    if (!isObj(item)) return null
    const op = parseOp(item.op)
    const enabled = bool(item.on)
    if (op === null || enabled === undefined) return null
    out.push({ op, enabled })
  }
  return out
}

/**
 * The fragment value (without `#p=`) for these steps, or `null` when they
 * cannot travel: none at all, or a value past the bounds a receiver would
 * reject. Encoding runs the same validator as decoding, so every link this
 * produces is one `decodePipeline` accepts.
 */
export async function encodePipeline(steps: readonly SharedStep[]): Promise<string | null> {
  // Round-tripped through the parser so stray fields are dropped here too.
  const checked = parseSharedSteps(toPayload(steps))
  return checked === null ? null : encodeCompact(toPayload(checked))
}

function toPayload(steps: readonly SharedStep[]) {
  return { v: PAYLOAD_VERSION, steps: steps.map((s) => ({ op: s.op, on: s.enabled })) }
}

/**
 * Read a pipeline link from a location hash (`#p=…`, or the bare value).
 * `null` for anything that is not an intact link this version wrote. Never
 * throws.
 */
export async function decodePipeline(hash: string): Promise<SharedStep[] | null> {
  const parsed = await decodeCompact(fragmentValue(hash, PIPELINE_PARAM), {
    maxDecodedBytes: MAX_PIPELINE_DECODED_BYTES,
  })
  return parseSharedSteps(parsed)
}
