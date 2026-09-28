import { describe, expect, it } from 'vitest'
import { isRawNumber, losslessSupported, parseLossless, rawNumberText } from './rawjson'
import { formatValue, minifyValue, withSortedKeys } from './format'
import { expandEmbedded, findEmbeddedJson } from './embedded'
import { allContainerPointers, countNodes, flattenTree, kindOf } from './tree'

const SRC = '{"z":12345678901234567890,"a":[1.0,-9223372036854775808,1e5,42,0.1],"s":"{\\"n\\":99999999999999999999}"}'

describe('parseLossless', () => {
  it('runs on this platform', () => {
    expect(losslessSupported).toBe(true)
  })

  it('keeps lossy and reformatted literals exactly, and leaves the rest as numbers', () => {
    const v = parseLossless(SRC) as { z: unknown; a: unknown[] }
    expect(isRawNumber(v.z)).toBe(true)
    expect(rawNumberText(v.z as never)).toBe('12345678901234567890')
    expect(v.a.map((n) => (isRawNumber(n) ? rawNumberText(n) : n))).toEqual([
      '1.0',
      '-9223372036854775808',
      '1e5',
      42,
      0.1,
    ])
  })

  it('round-trips minify byte-exactly', () => {
    expect(minifyValue(parseLossless(SRC), { sortKeys: false })).toBe(SRC)
  })

  it('formats and sorts keys without touching the digits', () => {
    const out = formatValue(parseLossless(SRC), { indent: 2, sortKeys: true })
    expect(out).toContain('"z": 12345678901234567890')
    expect(out.indexOf('"a"')).toBeLessThan(out.indexOf('"z"'))
    expect(JSON.stringify(withSortedKeys(parseLossless('{"b":1e5,"a":1}')))).toBe('{"a":1,"b":1e5}')
  })

  it('throws where JSON.parse throws', () => {
    expect(() => parseLossless('{"a":}')).toThrow()
  })
})

describe('walkers treat raw numbers as scalars', () => {
  const v = parseLossless(SRC)

  it('tree', () => {
    expect(kindOf((v as { z: unknown }).z)).toBe('number')
    const { expanded } = allContainerPointers(v)
    const rows = flattenTree(v, expanded)
    expect(rows.find((r) => r.pointer === '/z')).toMatchObject({
      kind: 'number',
      childCount: 0,
      preview: '12345678901234567890',
    })
    // 1 root + z + a + 5 items + s
    expect(countNodes(v)).toBe(9)
  })

  it('embedded expansion', () => {
    expect(findEmbeddedJson(v).map((e) => e.pointer)).toEqual(['/s'])
    const out = expandEmbedded(v).value as { z: unknown }
    expect(isRawNumber(out.z)).toBe(true)
  })
})
