import { split } from 'change-case'
import { pathKey, type IntRange, type ObjectShape, type Shape } from './shape.ts'

/** `go` upper-cases initialisms (`UserID`, `APIKey`), the way golint wants. */
export type Casing = 'pascal' | 'go'

/** One named object type in the output. */
export interface Decl {
  name: string
  object: ObjectShape
  /** Where it was first seen, as a jq-style path without the leading `.` at the root. */
  path: string
}

export interface Model {
  /**
   * The root, when it isn't itself one of `decls`: a primitive, a union, a
   * map, or the `RootList` array whose element type took the root's name.
   */
  alias: { name: string; shape: Shape } | null
  /** Named object types, root first, then in reading order. */
  decls: Decl[]
  declOf(object: ObjectShape): Decl
}

export type Kind =
  | { k: 'unknown' }
  | { k: 'object'; object: ObjectShape }
  | { k: 'map' }
  | { k: 'array'; items: Shape }
  | { k: 'string' }
  | { k: 'integer'; range: IntRange }
  | { k: 'number' }
  | { k: 'boolean' }

/**
 * What a position holds, minus null. An empty list with `nullable` means it
 * was only ever null; an empty list without it means nothing was seen.
 */
export function kindsOf(s: Shape): { kinds: Kind[]; nullable: boolean } {
  if (s.unknown) return { kinds: [{ k: 'unknown' }], nullable: false }
  const kinds: Kind[] = []
  if (s.object !== null) {
    // `{}` and nothing else says "some object", not "an object with no keys".
    kinds.push(s.object.fields.size > 0 ? { k: 'object', object: s.object } : { k: 'map' })
  }
  if (s.array !== null) kinds.push({ k: 'array', items: s.array.items })
  if (s.string) kinds.push({ k: 'string' })
  // `1` and `1.5` in the same place is a float, not a union.
  if (s.number) kinds.push({ k: 'number' })
  else if (s.integer !== null) kinds.push({ k: 'integer', range: s.integer })
  if (s.boolean) kinds.push({ k: 'boolean' })
  return { kinds, nullable: s.null }
}

export function isOptional(object: ObjectShape, key: string): boolean {
  return object.fields.get(key)!.count < object.samples
}

/** golint's list, plus a few that are as common in JSON keys. */
const INITIALISMS = new Set([
  'ACL', 'API', 'ASCII', 'CPU', 'CSS', 'CSV', 'DNS', 'EOF', 'GUID', 'HTML', 'HTTP', 'HTTPS', 'ID',
  'IP', 'JSON', 'JWT', 'LHS', 'OS', 'QPS', 'RAM', 'RHS', 'RPC', 'SDK', 'SKU', 'SLA', 'SMTP', 'SQL',
  'SSH', 'SSO', 'TCP', 'TLS', 'TTL', 'UDP', 'UI', 'UID', 'URI', 'URL', 'UTC', 'UTF8', 'UUID', 'VM',
  'XML', 'XMPP', 'XSRF', 'XSS',
])

function capitalize(word: string): string {
  const chars = [...word]
  return chars.length === 0 ? '' : chars[0]!.toUpperCase() + chars.slice(1).join('').toLowerCase()
}

/**
 * Words to an identifier: PascalCase, or Go's exported form. Anything that
 * isn't a letter or digit is dropped, and a name that would start with a digit
 * (or, in Go, a letter with no upper case, so unexported) gets a `The` prefix,
 * the convention quicktype users will recognise.
 */
export function identifier(words: readonly string[], casing: Casing, fallback: string): string {
  const joined = words
    .map((w) => (casing === 'go' && INITIALISMS.has(w.toUpperCase()) ? w.toUpperCase() : capitalize(w)))
    .join('')
    .replace(/[^\p{L}\p{Nd}_]/gu, '')
  if (joined === '') return fallback
  const first = [...joined][0]!
  const exported = casing === 'go' ? /\p{Lu}/u.test(first) : /\p{L}/u.test(first)
  return exported ? joined : `The${joined}`
}

/** Split a JSON key (or a typed root name) into words. */
export function wordsOf(text: string): string[] {
  return split(text)
}

const IRREGULAR: Record<string, string> = { children: 'child', people: 'person', men: 'man', women: 'woman' }

/** Plural-looking words that are their own singular. */
const SAME = new Set(['series', 'species', 'news', 'status', 'bus', 'gas'])

/**
 * The element type's name for an array under `words`: `users` → `User`. Only
 * the last word changes. A word these rules can't singularise (`data`, `info`)
 * gets `Item` instead, so the element never shares the array's name.
 */
export function singular(words: readonly string[]): string[] {
  if (words.length === 0) return ['item']
  const last = words[words.length - 1]!
  const lower = last.toLowerCase()
  if (lower === 'item') return [...words]
  if (SAME.has(lower)) return [...words, 'item']
  let one: string | null = null
  if (IRREGULAR[lower] !== undefined) one = IRREGULAR[lower]
  else if (/[^aeiou]ies$/.test(lower)) one = last.slice(0, -3) + 'y'
  else if (/(ss|sh|ch|x|z)es$/.test(lower)) one = last.slice(0, -2)
  else if (/[^su]s$/.test(lower) && !/(is|us|ss)$/.test(lower)) one = last.slice(0, -1)
  return one === null || one === '' ? [...words, 'item'] : [...words.slice(0, -1), one]
}

/**
 * Name every object type in `root`.
 *
 * Objects with the same structure (same keys, same optionality, same field
 * types, recursively) share one type, found by an interned structural hash so
 * the cost stays linear. A name already taken by a different structure is
 * prefixed with its parent's name, then numbered.
 */
export function buildModel(root: Shape, rootName: string, casing: Casing): Model {
  const ids = new Map<string, number>()
  const hashes = new WeakMap<ObjectShape, number>()

  function intern(key: string): number {
    let id = ids.get(key)
    if (id === undefined) {
      id = ids.size
      ids.set(key, id)
    }
    return id
  }

  function hashShape(s: Shape): string {
    const { kinds, nullable } = kindsOf(s)
    const parts = kinds.map((k) => {
      switch (k.k) {
        case 'object':
          return `o${hashObject(k.object)}`
        case 'array':
          return `a(${hashShape(k.items)})`
        case 'integer':
          return `i${k.range}`
        default:
          return k.k
      }
    })
    if (nullable) parts.push('null')
    return parts.join('|')
  }

  function hashObject(o: ObjectShape): number {
    const known = hashes.get(o)
    if (known !== undefined) return known
    const entries = [...o.fields.entries()]
      .map(([key, f]) => `${JSON.stringify(key)}${f.count < o.samples ? '?' : ''}:${hashShape(f.shape)}`)
      .toSorted()
    const id = intern(`{${entries.join(',')}}`)
    hashes.set(o, id)
    return id
  }

  const taken = new Set<string>()
  const byHash = new Map<number, Decl>()
  const decls: Decl[] = []

  function allocate(words: readonly string[], parent: string): string {
    const base = identifier(words, casing, 'Type')
    if (!taken.has(base)) return take(base)
    const prefixed = parent + base
    if (!taken.has(prefixed)) return take(prefixed)
    for (let n = 2; ; n++) if (!taken.has(`${prefixed}${n}`)) return take(`${prefixed}${n}`)
  }

  function take(name: string): string {
    taken.add(name)
    return name
  }

  function visitShape(s: Shape, words: readonly string[], parent: string, path: string): void {
    if (s.unknown) return
    if (s.object !== null && s.object.fields.size > 0) visitObject(s.object, words, parent, path, null)
    if (s.array !== null) visitShape(s.array.items, singular(words), parent, `${path}[]`)
  }

  function visitObject(
    o: ObjectShape,
    words: readonly string[],
    parent: string,
    path: string,
    fixedName: string | null,
  ): void {
    const hash = hashObject(o)
    if (byHash.has(hash)) return
    const name = fixedName ?? allocate(words, parent)
    const decl: Decl = { name, object: o, path }
    byHash.set(hash, decl)
    decls.push(decl)
    for (const [key, field] of o.fields) {
      visitShape(field.shape, wordsOf(key), name, `${path}${pathKey(key)}`)
    }
  }

  const rootIdent = rootIdentifier(rootName, casing)
  const only = kindsOf(root)
  const pureObject = only.kinds.length === 1 && only.kinds[0]!.k === 'object' && !only.nullable
  const itemKinds = root.array === null ? null : kindsOf(root.array.items)
  const isList =
    only.kinds.length === 1 &&
    only.kinds[0]!.k === 'array' &&
    !only.nullable &&
    itemKinds !== null &&
    itemKinds.kinds.some((k) => k.k === 'object')

  let alias: Model['alias'] = null
  if (pureObject) {
    visitObject(root.object!, [], '', '', take(rootIdent))
  } else if (isList) {
    const listName = take(`${rootIdent}List`)
    alias = { name: listName, shape: root }
    visitObject(root.array!.items.object!, [], '', '[]', take(rootIdent))
    visitShape(root.array!.items, [...wordsOf(rootIdent), 'item'], rootIdent, '[]')
  } else {
    alias = { name: take(rootIdent), shape: root }
    visitShape(root, [...wordsOf(rootIdent), 'item'], rootIdent, '')
  }

  return {
    alias,
    decls,
    declOf(object) {
      const decl = byHash.get(hashObject(object))
      if (decl === undefined) throw new Error('json-types: object shape was never named')
      return decl
    },
  }
}

/**
 * A root name typed as a valid identifier is kept exactly as typed
 * (`APIResponse` stays `APIResponse`); anything else is cased like a key.
 */
export function rootIdentifier(rootName: string, casing: Casing): string {
  const trimmed = rootName.trim()
  const valid = casing === 'go' ? /^\p{Lu}[\p{L}\p{Nd}_]*$/u : /^[\p{L}_$][\p{L}\p{Nd}_$]*$/u
  if (valid.test(trimmed)) return trimmed
  return identifier(wordsOf(trimmed), casing, 'Root')
}
