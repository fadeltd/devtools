import { EntryCollector, shortKey } from './collect.ts'
import { ENV_KEY, type EnvDoc } from './types.ts'

export interface JsonEnvOptions {
  /**
   * Turn `{"DB": {"HOST": "x"}}` into `DB__HOST=x` (arrays use the index:
   * `HOSTS__0`). Off by default: a nested value is usually a mistake, and
   * silently inventing key names would hide it.
   */
  flatten: boolean
  /** Joins flattened key segments. Default `__`, the .NET and Pydantic convention. */
  separator?: string
}

/*
 * A small JSON parser of our own instead of JSON.parse, for three reasons:
 * every key keeps its line number so issues point somewhere, number literals
 * keep their exact text (`12345678901234567890` and `1.0` survive), and a
 * repeated key is visible instead of being silently collapsed.
 */
type Node =
  | { kind: 'object'; at: number; members: { key: string; at: number; value: Node }[] }
  | { kind: 'array'; at: number; items: Node[] }
  | { kind: 'string'; at: number; value: string }
  | { kind: 'scalar'; at: number; text: string }
  | { kind: 'null'; at: number }

class JsonError {
  constructor(
    readonly at: number,
    readonly message: string,
  ) {}
}

const MAX_DEPTH = 512
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y

function parseJson(text: string): Node {
  let p = 0

  const ws = () => {
    while (p < text.length) {
      const c = text[p]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') p++
      else break
    }
  }

  // A declaration, not an arrow: TS only narrows after a `never` call when the
  // callee is declared with an explicit type.
  function fail(message: string, at = p): never {
    throw new JsonError(at, message)
  }

  const found = () => (p >= text.length ? 'the end of the input' : `"${text[p]}"`)

  const str = (): string => {
    const start = p
    p++ // opening quote
    let out = ''
    let run = p
    while (p < text.length) {
      const c = text.charCodeAt(p)
      if (c === 0x22) {
        out += text.slice(run, p)
        p++
        return out
      }
      if (c < 0x20) fail('A string cannot contain a raw line break or control character; use \\n.')
      if (c === 0x5c) {
        out += text.slice(run, p)
        const e = text[p + 1]
        if (e === 'u') {
          const hex = text.slice(p + 2, p + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Bad \\u escape; it needs four hex digits.')
          out += String.fromCharCode(Number.parseInt(hex, 16))
          p += 6
        } else {
          const m = e === undefined ? undefined : JSON_ESCAPES[e]
          if (m === undefined) fail(`Bad escape \\${e ?? ''} in a string.`)
          out += m
          p += 2
        }
        run = p
        continue
      }
      p++
    }
    return fail('This string is never closed.', start)
  }

  const value = (depth: number): Node => {
    if (depth > MAX_DEPTH) fail(`Nested more than ${MAX_DEPTH} levels deep.`)
    ws()
    const at = p
    const c = text[p]
    if (c === '{') {
      p++
      const members: { key: string; at: number; value: Node }[] = []
      ws()
      if (text[p] === '}') {
        p++
        return { kind: 'object', at, members }
      }
      for (;;) {
        ws()
        if (text[p] !== '"') fail(`Expected a quoted key, found ${found()}.`)
        const keyAt = p
        const key = str()
        ws()
        if (text[p] !== ':') fail(`Expected ":" after the key, found ${found()}.`)
        p++
        members.push({ key, at: keyAt, value: value(depth + 1) })
        ws()
        if (text[p] === ',') {
          p++
          continue
        }
        if (text[p] === '}') {
          p++
          return { kind: 'object', at, members }
        }
        fail(`Expected "," or "}", found ${found()}.`)
      }
    }
    if (c === '[') {
      p++
      const items: Node[] = []
      ws()
      if (text[p] === ']') {
        p++
        return { kind: 'array', at, items }
      }
      for (;;) {
        items.push(value(depth + 1))
        ws()
        if (text[p] === ',') {
          p++
          continue
        }
        if (text[p] === ']') {
          p++
          return { kind: 'array', at, items }
        }
        fail(`Expected "," or "]", found ${found()}.`)
      }
    }
    if (c === '"') return { kind: 'string', at, value: str() }
    for (const lit of ['true', 'false'] as const) {
      if (text.startsWith(lit, p)) {
        p += lit.length
        return { kind: 'scalar', at, text: lit }
      }
    }
    if (text.startsWith('null', p)) {
      p += 4
      return { kind: 'null', at }
    }
    NUMBER.lastIndex = p
    const m = NUMBER.exec(text)
    if (m !== null && m[0] !== '' && m[0] !== '-') {
      p += m[0].length
      return { kind: 'scalar', at, text: m[0] }
    }
    return fail(`Expected a value, found ${found()}.`)
  }

  const root = value(0)
  ws()
  if (p < text.length) fail(`Unexpected ${found()} after the end of the JSON.`)
  return root
}

const JSON_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/** 1-based line of each offset, counting CRLF, LF and lone CR like parseLines does. */
function lineIndex(text: string): (offset: number) => number {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\r') {
      if (text[i + 1] === '\n') i++
      starts.push(i + 1)
    } else if (c === '\n') {
      starts.push(i + 1)
    }
  }
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

/**
 * Read a JSON object as environment variables. Strings pass through, numbers
 * keep their literal text, booleans become `true`/`false`, `null` becomes an
 * empty value (with a warning). Nested objects and arrays are errors unless
 * `flatten` is on.
 */
export function parseJsonEnv(input: string, options: JsonEnvOptions): EnvDoc {
  const text = input.startsWith('﻿') ? input.slice(1) : input
  const lineAt = lineIndex(text)
  const out = new EntryCollector()

  let root: Node
  try {
    root = parseJson(text)
  } catch (e) {
    // The only throw inside parseJson is our own JsonError; anything else
    // (a stack overflow we failed to bound) still comes back as data.
    if (e instanceof JsonError) out.error(lineAt(e.at), `Invalid JSON: ${e.message}`)
    else out.error(1, 'Invalid JSON.')
    return out.done()
  }

  if (root.kind !== 'object') {
    out.error(lineAt(root.at), 'The top level must be an object of "KEY": "value" pairs.')
    return out.done()
  }

  const sep = options.separator ?? '__'

  const emit = (key: string, node: Node, line: number): void => {
    switch (node.kind) {
      case 'string':
      case 'scalar':
      case 'null':
        if (!ENV_KEY.test(key)) {
          out.error(line, `"${shortKey(key)}" is not a valid key. Use letters, digits, _, . and -, not starting with a digit.`)
          return
        }
        if (node.kind === 'null') out.warn(line, `${key} is null; it becomes an empty value.`)
        out.add({ key, value: node.kind === 'string' ? node.value : node.kind === 'scalar' ? node.text : '', line })
        return
      case 'object':
      case 'array': {
        const what = node.kind === 'object' ? 'an object' : 'an array'
        if (!options.flatten) {
          out.error(line, `${shortKey(key)} is ${what}. A .env value is a single string; turn on flatten to get ${shortKey(key)}${sep}… keys.`)
          return
        }
        const children =
          node.kind === 'object'
            ? node.members.map((m) => ({ key: m.key, node: m.value, line: lineAt(m.at) }))
            : node.items.map((n, i) => ({ key: String(i), node: n, line: lineAt(n.at) }))
        if (children.length === 0) {
          out.warn(line, `${shortKey(key)} is an empty ${node.kind}, so it produces no variables.`)
          return
        }
        for (const c of children) emit(`${key}${sep}${c.key}`, c.node, c.line)
        return
      }
    }
  }

  for (const m of root.members) emit(m.key, m.value, lineAt(m.at))
  return out.done()
}
