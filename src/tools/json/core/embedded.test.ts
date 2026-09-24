import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  escapePointerToken,
  expandEmbedded,
  findEmbeddedJson,
  parseEmbedded,
  toDotPath,
  toJsonPointer,
} from './embedded'

describe('JSON pointers (RFC 6901)', () => {
  it('escapes ~ before /', () => {
    // Order matters: escaping / first would turn "a/b" into "a~1b" and then
    // the ~ escape would corrupt it into "a~01b".
    expect(escapePointerToken('a~b')).toBe('a~0b')
    expect(escapePointerToken('a/b')).toBe('a~1b')
    expect(escapePointerToken('a~/b')).toBe('a~0~1b')
  })

  it('builds pointers for paths', () => {
    expect(toJsonPointer([])).toBe('')
    expect(toJsonPointer(['a'])).toBe('/a')
    expect(toJsonPointer(['a', 0, 'b'])).toBe('/a/0/b')
    expect(toJsonPointer(['a/b'])).toBe('/a~1b')
  })
})

describe('toDotPath', () => {
  it('uses dots for identifiers and brackets for the rest', () => {
    expect(toDotPath([])).toBe('$')
    expect(toDotPath(['items', 0, 'id'])).toBe('items[0].id')
    expect(toDotPath(['a-b'])).toBe('["a-b"]')
    expect(toDotPath(['a', 'b c'])).toBe('a["b c"]')
  })
})

describe('parseEmbedded', () => {
  it('accepts objects and arrays', () => {
    expect(parseEmbedded('{"a":1}')?.kind).toBe('object')
    expect(parseEmbedded('[1,2]')?.kind).toBe('array')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseEmbedded('  {"a":1}  ')?.kind).toBe('object')
  })

  it('refuses strings that parse to scalars', () => {
    // Expanding these would silently retype the document: the author wrote a
    // string, and showing 42 instead would misrepresent it.
    expect(parseEmbedded('42')).toBeNull()
    expect(parseEmbedded('true')).toBeNull()
    expect(parseEmbedded('null')).toBeNull()
    expect(parseEmbedded('"nested string"')).toBeNull()
  })

  it('refuses ordinary prose and malformed JSON', () => {
    expect(parseEmbedded('hello world')).toBeNull()
    expect(parseEmbedded('{not json}')).toBeNull()
    expect(parseEmbedded('{"a":1')).toBeNull()
    expect(parseEmbedded('')).toBeNull()
  })

  it('refuses a string that merely starts with a brace', () => {
    expect(parseEmbedded('{ this is a log line')).toBeNull()
  })

  it('respects the length cap', () => {
    const big = `{"a":"${'x'.repeat(100)}"}`
    expect(parseEmbedded(big, 10)).toBeNull()
    expect(parseEmbedded(big, 10_000)?.kind).toBe('object')
  })
})

describe('findEmbeddedJson', () => {
  it('finds a directly embedded payload', () => {
    const doc = { level: 'info', payload: '{"userId":42}' }
    const found = findEmbeddedJson(doc)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ pointer: '/payload', depth: 1, kind: 'object' })
  })

  it('finds payloads nested in arrays', () => {
    const doc = { logs: [{ body: '[1,2,3]' }] }
    expect(findEmbeddedJson(doc)[0]?.pointer).toBe('/logs/0/body')
  })

  it('finds double-encoded payloads and reports increasing depth', () => {
    // The real shape: a service JSON-encodes a payload that was already encoded.
    const inner = JSON.stringify({ id: 1 })
    const doc = { payload: JSON.stringify({ body: inner }) }
    const found = findEmbeddedJson(doc)
    expect(found.map((f) => [f.pointer, f.depth])).toEqual([
      ['/payload', 1],
      ['/payload/body', 2],
    ])
  })

  it('escapes keys containing slashes in the pointer', () => {
    expect(findEmbeddedJson({ 'a/b': '{"x":1}' })[0]?.pointer).toBe('/a~1b')
  })

  it('finds nothing in a document with no embedded JSON', () => {
    expect(findEmbeddedJson({ a: 1, b: 'plain', c: [1, 2] })).toEqual([])
  })

  it('handles a bare string at the root', () => {
    expect(findEmbeddedJson('{"a":1}')[0]?.pointer).toBe('')
  })

  it('respects maxDepth', () => {
    let nested: string = JSON.stringify({ end: true })
    for (let i = 0; i < 5; i++) nested = JSON.stringify({ next: nested })
    expect(findEmbeddedJson({ p: nested }, { maxDepth: 2 }).length).toBeLessThanOrEqual(2)
  })
})

describe('expandEmbedded', () => {
  it('replaces the string with the parsed value', () => {
    const doc = { level: 'info', payload: '{"userId":42}' }
    const { value, expanded } = expandEmbedded(doc)
    expect(value).toEqual({ level: 'info', payload: { userId: 42 } })
    expect(expanded).toHaveLength(1)
  })

  it('unwraps double-encoded payloads all the way down', () => {
    const doc = { payload: JSON.stringify({ body: JSON.stringify({ id: 1 }) }) }
    expect(expandEmbedded(doc).value).toEqual({ payload: { body: { id: 1 } } })
  })

  it('does not mutate the input', () => {
    const doc = { payload: '{"a":1}' }
    const snapshot = structuredClone(doc)
    expandEmbedded(doc)
    expect(doc).toEqual(snapshot)
  })

  it('leaves non-JSON strings exactly as they were', () => {
    const doc = { msg: 'request failed: {timeout}', n: 5, ok: true, nil: null }
    expect(expandEmbedded(doc).value).toEqual(doc)
  })

  it('expands inside arrays', () => {
    const doc = { logs: ['{"a":1}', '{"b":2}'] }
    expect(expandEmbedded(doc).value).toEqual({ logs: [{ a: 1 }, { b: 2 }] })
  })

  it('expands only the requested pointers', () => {
    const doc = { a: '{"x":1}', b: '{"y":2}' }
    const { value } = expandEmbedded(doc, { only: new Set(['/a']) })
    expect(value).toEqual({ a: { x: 1 }, b: '{"y":2}' })
  })

  it('reports the raw length it saved you reading', () => {
    const raw = JSON.stringify({ a: 1, b: 2, c: 3 })
    expect(expandEmbedded({ p: raw }).expanded[0]?.rawLength).toBe(raw.length)
  })

  it('handles an empty object and array', () => {
    expect(expandEmbedded({ a: '{}', b: '[]' }).value).toEqual({ a: {}, b: [] })
  })

  it('preserves key order', () => {
    const doc = { z: 1, payload: '{"a":1}', a: 2 }
    expect(Object.keys(expandEmbedded(doc).value as object)).toEqual(['z', 'payload', 'a'])
  })
})

describe('reversibility', () => {
  it('expansion is a view: the original text still round-trips', () => {
    // Expansion never edits the source, so re-parsing the untouched original
    // is exactly what "collapse" means. This is why no inverse exists.
    const text = '{"payload":"{\\"userId\\":42}"}'
    const original = JSON.parse(text) as unknown
    expandEmbedded(original)
    expect(JSON.stringify(original)).toBe(text)
  })

  it('findEmbeddedJson and expandEmbedded agree on what is expandable', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 6 }),
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.constant('{"a":1}'),
            fc.constant('[1,2]'),
            fc.constant('not json'),
          ),
          { maxKeys: 8 },
        ),
        (doc) => {
          const found = findEmbeddedJson(doc)
          const { expanded } = expandEmbedded(doc)
          expect(expanded.map((e) => e.pointer).toSorted()).toEqual(
            found.map((e) => e.pointer).toSorted(),
          )
        },
      ),
      { numRuns: 200 },
    )
  })

  it('expanding twice is idempotent', () => {
    const doc = { payload: '{"a":"{\\"b\\":1}"}' }
    const once = expandEmbedded(doc).value
    expect(expandEmbedded(once).value).toEqual(once)
  })
})
