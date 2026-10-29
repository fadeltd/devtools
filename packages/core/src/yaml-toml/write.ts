import { Document, visit } from 'yaml'
import { stringify as stringifyToml } from 'smol-toml'
import { toJqPath, type PathSegment } from '../json/paths.ts'
import { message, type Message, type SourceText } from './messages.ts'
import type { Format, Reading } from './read.ts'

/** Indent for JSON and YAML output. YAML has no tabs or minified form, and falls back to 2. */
export type Indent = 2 | 4 | 'tab' | 'minify'

/** Errors listed one by one before the rest are summarised. */
const MAX_LISTED = 20

const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n

interface Prep {
  target: Format
  doc: number
  reading: Reading
  src: SourceText
  errors: Message[]
  nulls: number
  dates: number
  bigLossy: { count: number; first: string; firstPath: string }
  int64: { count: number; first: string; firstPath: string }
  nonFinite: { count: number; firstPath: string }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v) as unknown
  // smol-toml builds tables with a null prototype.
  return proto === Object.prototype || proto === null
}

function positionOf(p: Prep, path: readonly PathSegment[]) {
  const offset = p.reading.locate(p.doc, path)
  return offset === null ? {} : p.src.atOffset(offset)
}

/**
 * Turn a parsed value into what the target can hold, collecting everything
 * worth saying on the way: TOML dates become ISO strings for JSON and YAML,
 * nulls are refused by TOML, and integers that a double cannot print exactly
 * stay as bigints.
 *
 * Objects are rebuilt with Object.fromEntries, never by assignment, so a
 * `__proto__` key stays an ordinary key instead of reaching the prototype.
 */
function prepare(value: unknown, path: PathSegment[], p: Prep): unknown {
  if (value === null) {
    if (p.target === 'toml') {
      p.nulls++
      if (p.nulls <= MAX_LISTED) {
        const where = toJqPath(path)
        p.errors.push(
          message('toml-null', `${where} is null, and TOML has no null.`, {
            hint: 'Remove the key, or give it a value such as "" or false.',
            path: where,
            ...positionOf(p, path),
          }),
        )
      }
    }
    return null
  }

  switch (typeof value) {
    case 'bigint': {
      // Integers that print the same as a double go back to being numbers,
      // so JSON output can take the native JSON.stringify fast path.
      if (p.target === 'json') {
        const n = Number(value)
        if (String(n) === value.toString()) return n
        // Not Number.isSafeInteger: it false-positives on 2^53, which a
        // double holds exactly.
        if (BigInt(n) !== value) {
          if (p.bigLossy.count++ === 0) {
            p.bigLossy.first = value.toString()
            p.bigLossy.firstPath = toJqPath(path)
          }
        }
      } else if (p.target === 'toml' && (value < INT64_MIN || value > INT64_MAX)) {
        if (p.int64.count++ === 0) {
          p.int64.first = value.toString()
          p.int64.firstPath = toJqPath(path)
        }
      }
      return value
    }
    case 'number':
      if (p.target === 'json' && !Number.isFinite(value)) {
        if (p.nonFinite.count++ === 0) p.nonFinite.firstPath = toJqPath(path)
      }
      return value
    case 'string':
    case 'boolean':
      return value
    default:
      break
  }

  if (value instanceof Date) {
    if (p.target === 'toml') return value
    p.dates++
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((v, i) => prepare(v, [...path, i], p))
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, prepare(v, [...path, k], p)]),
    )
  }

  // Only reachable through a YAML 1.1 type (!!set, !!omap, !!binary) under a
  // %YAML 1.1 directive; there is no faithful way to carry those across.
  const where = toJqPath(path)
  p.errors.push(
    message('unsupported-value', `${where} is a YAML-only type with no equivalent here.`, {
      path: where,
      ...positionOf(p, path),
    }),
  )
  return null
}

export interface Prepared {
  value: unknown
  errors: Message[]
  warnings: Message[]
  notes: Message[]
}

export function prepareFor(
  value: unknown,
  target: Format,
  doc: number,
  reading: Reading,
  src: SourceText,
): Prepared {
  const p: Prep = {
    target,
    doc,
    reading,
    src,
    errors: [],
    nulls: 0,
    dates: 0,
    bigLossy: { count: 0, first: '', firstPath: '' },
    int64: { count: 0, first: '', firstPath: '' },
    nonFinite: { count: 0, firstPath: '' },
  }
  const out = prepare(value, [], p)
  const warnings: Message[] = []
  const notes: Message[] = []

  if (p.nulls > MAX_LISTED) {
    p.errors.push(message('toml-null-more', `…and ${p.nulls - MAX_LISTED} more null values.`))
  }
  if (p.dates > 0) {
    notes.push(
      message(
        'dates-as-strings',
        `${p.dates} date${p.dates === 1 ? '' : 's'} written as ISO 8601 strings: ${target === 'json' ? 'JSON' : 'YAML 1.2'} has no date type.`,
      ),
    )
  }
  if (p.bigLossy.count > 0) {
    const { count, first, firstPath } = p.bigLossy
    warnings.push(
      message(
        'big-integer',
        `${count} integer${count === 1 ? '' : 's'} beyond 2^53 (e.g. ${firstPath} = ${first}) ${count === 1 ? 'is' : 'are'} written exactly, but JSON.parse in JavaScript, and many other JSON readers, will round ${count === 1 ? 'it' : 'them'} to ${String(Number(first))}.`,
        { hint: 'If the reader cannot keep big integers, store them as strings.', path: firstPath },
      ),
    )
  }
  if (p.int64.count > 0) {
    const { count, first, firstPath } = p.int64
    warnings.push(
      message(
        'toml-int64',
        `${count} integer${count === 1 ? '' : 's'} (e.g. ${firstPath} = ${first}) ${count === 1 ? 'is' : 'are'} outside TOML's 64-bit range; most TOML parsers will reject ${count === 1 ? 'it' : 'them'}.`,
        { path: firstPath },
      ),
    )
  }
  if (p.nonFinite.count > 0) {
    const { count, firstPath } = p.nonFinite
    warnings.push(
      message(
        'json-non-finite',
        `${count} NaN or infinite number${count === 1 ? '' : 's'} (e.g. ${firstPath}) written as null: JSON cannot hold them.`,
        { path: firstPath },
      ),
    )
  }
  return { value: out, errors: p.errors, warnings, notes }
}

// ---------------------------------------------------------------- JSON

function gapOf(indent: Indent): string {
  if (indent === 'minify') return ''
  if (indent === 'tab') return '\t'
  return ' '.repeat(indent)
}

function containsBigInt(v: unknown): boolean {
  if (typeof v === 'bigint') return true
  if (Array.isArray(v)) return v.some(containsBigInt)
  if (v !== null && typeof v === 'object') return Object.values(v).some(containsBigInt)
  return false
}

/**
 * JSON.stringify, except that a bigint is written as its digits.
 *
 * The JSON tool keeps big numbers exact with JSON.rawJSON; that API is
 * missing in Safari < 18.4, and a bigint here can come from TOML or YAML on
 * any browser. So when one is present we serialise ourselves, matching
 * JSON.stringify's layout byte for byte (a property test holds us to that).
 */
export function stringifyJson(value: unknown, indent: Indent): string {
  const gap = gapOf(indent)
  if (!containsBigInt(value)) return JSON.stringify(value, null, gap)

  const colon = gap === '' ? ':' : ': '
  const walk = (v: unknown, pad: string): string => {
    if (v === null) return 'null'
    switch (typeof v) {
      case 'bigint':
        return v.toString()
      case 'number':
        return Number.isFinite(v) ? JSON.stringify(v) : 'null'
      case 'string':
        return JSON.stringify(v)
      case 'boolean':
        return v ? 'true' : 'false'
      default:
        break
    }
    const inner = pad + gap
    const open = gap === '' ? '' : `\n${inner}`
    const sep = gap === '' ? ',' : `,\n${inner}`
    const close = gap === '' ? '' : `\n${pad}`
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      return `[${open}${v.map((x) => walk(x, inner)).join(sep)}${close}]`
    }
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return `{${open}${entries.map(([k, x]) => JSON.stringify(k) + colon + walk(x, inner)).join(sep)}${close}}`
  }
  return walk(value, '')
}

// ---------------------------------------------------------------- YAML

function yamlIndent(indent: Indent): number {
  return indent === 4 ? 4 : 2
}

export interface YamlWriteOptions {
  indent: Indent
  /**
   * The source told integers (bigint) and floats (number) apart, so write a
   * whole float as `1.0` -- otherwise TOML → YAML → TOML turns floats into
   * integers.
   */
  keepFloats: boolean
}

const TO_STRING = { lineWidth: 0, minContentWidth: 0 } as const

export function writeYamlValue(value: unknown, o: YamlWriteOptions): string {
  const doc = new Document(value, {
    // Quote strings a YAML 1.1 reader would misread (no, on, 0755, 1:20),
    // so the output means the same thing to PyYAML as it does here.
    compat: 'yaml-1.1',
    // Shared objects become plain copies, never &anchors the input did not have.
    aliasDuplicateObjects: false,
  })
  if (o.keepFloats) {
    visit(doc, {
      Scalar(_key, node) {
        if (typeof node.value === 'number' && Number.isInteger(node.value)) node.minFractionDigits = 1
      },
    })
  }
  // lineWidth 0: never fold a long string across lines; a converter should
  // not reflow data.
  return doc.toString({ ...TO_STRING, indent: yamlIndent(o.indent) })
}

/** YAML → YAML: re-render the parsed documents, keeping comments and anchors. */
export function writeYamlDocs(docs: readonly Document[], indent: Indent): string {
  return docs
    .map((d, i) => {
      const s = d.toString({ ...TO_STRING, indent: yamlIndent(indent) })
      return i > 0 && !s.startsWith('---') ? `---\n${s}` : s
    })
    .join('')
}

// ---------------------------------------------------------------- TOML

export function writeToml(
  value: unknown,
  o: { keepFloats: boolean },
): { ok: true; text: string } | { ok: false; error: Message } {
  if (!isPlainObject(value)) {
    const kind = Array.isArray(value) ? 'an array' : value === null ? 'null' : `a ${typeof value}`
    return {
      ok: false,
      error: message('toml-root', `TOML needs a table at the top level, but this document is ${kind}.`, {
        hint: 'Wrap it in a key, e.g. { "items": … }.',
      }),
    }
  }
  try {
    // numbersAsFloat: when integers arrive as bigints, every remaining number
    // is a float and is written as one (1.0, not 1).
    return { ok: true, text: stringifyToml(value, { numbersAsFloat: o.keepFloats }) }
  } catch (e) {
    return {
      ok: false,
      error: message('toml-rejected', `TOML cannot represent this: ${e instanceof Error ? e.message : String(e)}`),
    }
  }
}
