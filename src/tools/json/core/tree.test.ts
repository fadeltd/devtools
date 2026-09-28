import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  PREVIEW_MAX,
  allContainerPointers,
  countNodes,
  defaultExpanded,
  flattenTree,
  kindOf,
  toggle,
} from './tree'

const doc = {
  a: 1,
  'x/y': { '~k': [true, null, 'z'] },
  list: [{ id: 1 }, { id: 2 }],
}

describe('flattenTree', () => {
  it('shows only the root when nothing is expanded', () => {
    const rows = flattenTree(doc, new Set())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ pointer: '', depth: 0, key: null, kind: 'object', childCount: 3 })
    expect(rows[0]!.expanded).toBe(false)
  })

  it('gives a scalar root a single row with its preview', () => {
    expect(flattenTree(42, new Set(['']))).toEqual([
      expect.objectContaining({ kind: 'number', preview: '42', childCount: 0, expanded: false }),
    ])
    expect(flattenTree('hi', new Set())[0]!.preview).toBe('"hi"')
    expect(flattenTree(null, new Set())[0]!.kind).toBe('null')
  })

  it('escapes keys in pointers per RFC 6901', () => {
    const { expanded } = allContainerPointers(doc)
    const pointers = flattenTree(doc, expanded).map((r) => r.pointer)
    expect(pointers).toContain('/x~1y')
    expect(pointers).toContain('/x~1y/~0k/2')
  })

  it('emits rows in pre-order with correct depth and parent', () => {
    const { expanded } = allContainerPointers(doc)
    const rows = flattenTree(doc, expanded)
    expect(rows.map((r) => r.pointer)).toEqual([
      '',
      '/a',
      '/x~1y',
      '/x~1y/~0k',
      '/x~1y/~0k/0',
      '/x~1y/~0k/1',
      '/x~1y/~0k/2',
      '/list',
      '/list/0',
      '/list/0/id',
      '/list/1',
      '/list/1/id',
    ])
    for (const [i, row] of rows.entries()) {
      if (i === 0) expect(row.parent).toBe(-1)
      else expect(rows[row.parent]!.depth).toBe(row.depth - 1)
    }
    expect(rows[4]!.path).toEqual(['x/y', '~k', 0])
    expect(rows[4]!.key).toBe(0)
  })

  it('never marks an empty container as expanded', () => {
    const rows = flattenTree({ e: {}, f: [] }, new Set(['', '/e', '/f']))
    expect(rows.slice(1).map((r) => r.expanded)).toEqual([false, false])
  })

  it('caps long string previews', () => {
    const [row] = flattenTree('x'.repeat(PREVIEW_MAX * 3), new Set())
    expect(row!.preview.length).toBeLessThan(PREVIEW_MAX + 5)
    expect(row!.preview.endsWith('…"')).toBe(true)
  })

  it('survives nesting far deeper than the call stack allows', () => {
    let deep: unknown = 0
    for (let i = 0; i < 20_000; i++) deep = [deep]
    const { expanded } = allContainerPointers(deep, Infinity)
    expect(flattenTree(deep, expanded)).toHaveLength(20_001)
  })
})

const json = fc.jsonValue({ maxDepth: 4 })

describe('flattenTree properties', () => {
  it('fully expanded, has one row per node with unique pointers', () => {
    fc.assert(
      fc.property(json, (value) => {
        const { expanded } = allContainerPointers(value, Infinity)
        const rows = flattenTree(value, expanded)
        expect(rows).toHaveLength(countNodes(value))
        expect(new Set(rows.map((r) => r.pointer)).size).toBe(rows.length)
      }),
    )
  })

  it('collapsing a node removes exactly its descendants', () => {
    fc.assert(
      fc.property(json, fc.nat(), (value, pick) => {
        const { expanded } = allContainerPointers(value, Infinity)
        const open = flattenTree(value, expanded)
        const containers = open.filter((r) => r.expanded)
        if (containers.length === 0) return
        const target = containers[pick % containers.length]!

        const closed = flattenTree(value, toggle(expanded, target.pointer))
        const prefix = target.pointer + '/'
        const expected = open.filter((r) => !r.pointer.startsWith(prefix))
        expect(closed.map((r) => r.pointer)).toEqual(expected.map((r) => r.pointer))
      }),
    )
  })
})

describe('defaultExpanded', () => {
  it('opens the root and the first level of containers', () => {
    const set = defaultExpanded(doc)
    expect([...set].toSorted()).toEqual(['', '/list', '/x~1y'])
  })

  it('opens nothing for a scalar or empty root', () => {
    expect(defaultExpanded(1).size).toBe(0)
    expect(defaultExpanded({}).size).toBe(0)
  })

  it('stops before the visible rows exceed maxRows', () => {
    const wide = Array.from({ length: 50 }, () => Array.from({ length: 30 }, (_, i) => i))
    const set = defaultExpanded(wide, { maxRows: 200 })
    const rows = flattenTree(wide, set)
    expect(rows.length).toBeLessThanOrEqual(200)
    expect(set.has('')).toBe(true)
  })

  it('always opens the root, even past maxRows', () => {
    const big = Array.from({ length: 5000 }, (_, i) => i)
    expect(defaultExpanded(big, { maxRows: 10 }).has('')).toBe(true)
  })
})

describe('allContainerPointers', () => {
  it('reports when the row cap was hit', () => {
    const big = Array.from({ length: 100 }, () => ({ a: 1, b: 2 }))
    const capped = allContainerPointers(big, 150)
    expect(capped.capped).toBe(true)
    expect(flattenTree(big, capped.expanded).length).toBeLessThanOrEqual(150)
    expect(allContainerPointers(big).capped).toBe(false)
  })
})

describe('scale', () => {
  it('flattens 100k nodes, and a collapsed root costs one row', () => {
    const big = Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: `n${i}`, ok: true, v: null }))
    expect(flattenTree(big, new Set())).toHaveLength(1)
    const { expanded } = allContainerPointers(big)
    expect(flattenTree(big, expanded)).toHaveLength(100_001)
  })
})

describe('kindOf', () => {
  it('classifies every JSON type', () => {
    expect([{}, [], '', 0, false, null].map(kindOf)).toEqual([
      'object',
      'array',
      'string',
      'number',
      'boolean',
      'null',
    ])
  })
})
