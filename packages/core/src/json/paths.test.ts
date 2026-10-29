import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toDotPath, toJsonPointer } from './embedded.ts'
import {
  MISSING,
  detectPathFlavor,
  formatPath,
  parseDotPath,
  parseJqPath,
  parsePointer,
  resolvePath,
  selectPath,
  toJqPath,
} from './paths.ts'
import { allContainerPointers, flattenTree, pathOf } from './tree.ts'

describe('toJqPath', () => {
  it('uses dots for identifiers and brackets for the rest', () => {
    expect(toJqPath([])).toBe('.')
    expect(toJqPath(['items', 0, 'id'])).toBe('.items[0].id')
    expect(toJqPath([0, 'a'])).toBe('.[0].a')
    expect(toJqPath(['a-b'])).toBe('.["a-b"]')
    expect(toJqPath(['a', 'b c'])).toBe('.a["b c"]')
    // `$` is a JS identifier character but not a jq one.
    expect(toJqPath(['$ref'])).toBe('.["$ref"]')
  })
})

describe('toDotPath', () => {
  it('does not confuse a "$" key with the root', () => {
    expect(toDotPath(['$'])).not.toBe(toDotPath([]))
    expect(parseDotPath(toDotPath(['$']))).toEqual(['$'])
  })
})

describe('parsers', () => {
  it('reads each flavour back', () => {
    expect(parsePointer('/a~1b/~0c/0')).toEqual(['a/b', '~c', '0'])
    expect(parseDotPath('items[0]["a b"].c')).toEqual(['items', 0, 'a b', 'c'])
    expect(parseJqPath('.items[0]["a\\"b"]')).toEqual(['items', 0, 'a"b'])
    expect(parseJqPath('.[0]')).toEqual([0])
  })

  it('rejects garbage', () => {
    expect(() => parsePointer('a')).toThrow()
    expect(() => parseJqPath('a')).toThrow()
    expect(() => parseDotPath('a[x]')).toThrow()
  })
})

const doc = {
  items: [{ id: 1, 'a b': { '~/': true } }],
  '0': 'zero-key',
  $: 'dollar',
  '': 'empty',
  'é': ['ü'],
}

describe('every row round-trips in all three flavours', () => {
  const { expanded } = allContainerPointers(doc)
  const rows = flattenTree(doc, expanded)

  for (const [index, row] of rows.entries()) {
    it(row.pointer === '' ? '(root)' : row.pointer, () => {
      const path = pathOf(rows, index)
      const target = resolvePath(doc, path)
      expect(target).not.toBe(MISSING)
      expect(toJsonPointer(path)).toBe(row.pointer)
      expect(resolvePath(doc, parsePointer(toJsonPointer(path)))).toBe(target)
      expect(resolvePath(doc, parseDotPath(toDotPath(path)))).toBe(target)
      expect(resolvePath(doc, parseJqPath(toJqPath(path)))).toBe(target)
    })
  }
})

describe('round-trip properties', () => {
  const segment = fc.oneof(fc.nat({ max: 50 }), fc.string(), fc.constantFrom('$', '0', '~1', 'a.b', '[x]'))

  it('dot and jq paths parse back to the exact segments', () => {
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 6 }), (path) => {
        expect(parseDotPath(toDotPath(path))).toEqual(path)
        expect(parseJqPath(toJqPath(path))).toEqual(path)
      }),
    )
  })

  it('pointers parse back to the stringified segments', () => {
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 6 }), (path) => {
        expect(parsePointer(toJsonPointer(path))).toEqual(path.map(String))
      }),
    )
  })
})

describe('parseDotPath with a JSONPath root', () => {
  it('reads $. and $[ as the root marker', () => {
    expect(parseDotPath('$.items[0].id')).toEqual(['items', 0, 'id'])
    expect(parseDotPath('$[0]')).toEqual([0])
    expect(parseDotPath('$ref.a')).toEqual(['$ref', 'a'])
  })
})

describe('detectPathFlavor', () => {
  it('tells the flavours apart by their first character', () => {
    expect(detectPathFlavor('/items/0')).toBe('pointer')
    expect(detectPathFlavor('.items[0]')).toBe('jq')
    expect(detectPathFlavor('items[0]')).toBe('dot')
    expect(detectPathFlavor('[0].id')).toBe('dot')
    expect(detectPathFlavor('$.items')).toBe('dot')
  })
})

describe('selectPath', () => {
  const data = { items: [{ id: 7, tags: ['a'] }], 'a b': null, '': 'empty' }

  it('selects the same node from every flavour', () => {
    for (const src of ['/items/0/id', 'items[0].id', '.items[0].id', '$.items[0].id', '  .items[0].id  ']) {
      const r = selectPath(data, src)
      expect(r).toMatchObject({ ok: true, value: 7, path: ['items', 0, 'id'] })
    }
  })

  it('treats blank, "/", "." and "$" as the whole document', () => {
    for (const src of ['', '  ', '/', '.', '$']) {
      expect(selectPath(data, src)).toMatchObject({ ok: true, value: data, path: [] })
    }
  })

  it('normalises pointer tokens into array indices', () => {
    const r = selectPath(data, '/items/0/tags/0')
    expect(r).toMatchObject({ ok: true, value: 'a', path: ['items', 0, 'tags', 0] })
  })

  it('reaches keys that are not identifiers', () => {
    expect(selectPath(data, '.["a b"]')).toMatchObject({ ok: true, value: null })
    expect(selectPath(data, '.[""]')).toMatchObject({ ok: true, value: 'empty' })
  })

  it('says where the walk stopped, in the flavour that was typed', () => {
    expect(selectPath(data, '.items[0].nope')).toEqual({
      ok: false,
      flavor: 'jq',
      message: '.items[0] has no key "nope"',
    })
    expect(selectPath(data, '/items/3')).toEqual({
      ok: false,
      flavor: 'pointer',
      message: '/items has 1 item; there is no [3]',
    })
    expect(selectPath(data, 'items[0].id.x')).toEqual({
      ok: false,
      flavor: 'dot',
      message: 'items[0].id is a number, so it has no children',
    })
    expect(selectPath(data, '/items/-')).toMatchObject({
      ok: false,
      message: '/items is an array; "-" is not an index',
    })
    expect(selectPath(data, '.missing')).toMatchObject({ ok: false, message: 'the root has no key "missing"' })
  })

  it('reports a malformed path instead of throwing', () => {
    const r = selectPath(data, '.items[0')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/^Not a valid path/)
  })

  it('agrees with resolvePath on every row of a document', () => {
    const { expanded } = allContainerPointers(doc)
    const rows = flattenTree(doc, expanded)
    for (const [index] of rows.entries()) {
      const path = pathOf(rows, index)
      for (const flavor of ['pointer', 'dot', 'jq'] as const) {
        const src = formatPath(path, flavor)
        // '' as a pointer is the root, but so is '/' here; the one key that
        // collides is the "" key, which needs the jq or dot form.
        if (flavor === 'pointer' && path.length === 1 && path[0] === '') continue
        const r = selectPath(doc, src)
        expect(r).toMatchObject({ ok: true, path })
        if (r.ok) expect(r.value).toBe(resolvePath(doc, path))
      }
    }
  })
})
