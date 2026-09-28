import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toDotPath, toJsonPointer } from './embedded'
import {
  MISSING,
  parseDotPath,
  parseJqPath,
  parsePointer,
  resolvePath,
  toJqPath,
} from './paths'
import { allContainerPointers, flattenTree, pathOf } from './tree'

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
