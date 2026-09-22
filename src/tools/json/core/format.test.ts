import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  escapeAsJsonString,
  findNumberIssues,
  formatValue,
  mayHaveLossyNumbers,
  minifyValue,
  ndjsonToArray,
  sortKeysDeep,
  unescapeJsonString,
} from './format'

describe('formatValue / minifyValue', () => {
  it('pretty-prints with the requested indent', () => {
    expect(formatValue({ a: 1 }, { indent: 2, sortKeys: false })).toBe('{\n  "a": 1\n}')
    expect(formatValue({ a: 1 }, { indent: 4, sortKeys: false })).toBe('{\n    "a": 1\n}')
    expect(formatValue({ a: 1 }, { indent: 'tab', sortKeys: false })).toBe('{\n\t"a": 1\n}')
  })

  it('minifies', () => {
    expect(minifyValue({ a: [1, 2] }, { sortKeys: false })).toBe('{"a":[1,2]}')
  })

  it('preserves key insertion order when not sorting', () => {
    expect(minifyValue({ b: 1, a: 2 }, { sortKeys: false })).toBe('{"b":1,"a":2}')
  })
})

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

describe('sortKeysDeep', () => {

  it('sorts nested object keys', () => {
    const out = sortKeysDeep({ b: 1, a: { d: 2, c: 3 } }, cmp)
    expect(JSON.stringify(out)).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('never reorders arrays', () => {
    const out = sortKeysDeep({ list: [3, 1, 2] }, cmp)
    expect(JSON.stringify(out)).toBe('{"list":[3,1,2]}')
  })

  it('sorts keys of objects inside arrays', () => {
    const out = sortKeysDeep([{ b: 1, a: 2 }], cmp)
    expect(JSON.stringify(out)).toBe('[{"a":2,"b":1}]')
  })

  it('leaves primitives and null alone', () => {
    expect(sortKeysDeep(null, cmp)).toBeNull()
    expect(sortKeysDeep(5, cmp)).toBe(5)
    expect(sortKeysDeep('s', cmp)).toBe('s')
  })
})

describe('escape / unescape', () => {
  it('wraps a string as a JSON literal', () => {
    expect(escapeAsJsonString('a"b\n', { ascii: false })).toBe('"a\\"b\\n"')
  })

  it('escapes non-ASCII when asked', () => {
    expect(escapeAsJsonString('é', { ascii: true })).toBe('"\\u00e9"')
    expect(escapeAsJsonString('é', { ascii: false })).toBe('"é"')
  })

  it('reads a quoted JSON string', () => {
    const r = unescapeJsonString('"a\\nb"')
    expect(r.ok && r.value).toBe('a\nb')
  })

  it('reads an unquoted escaped string', () => {
    const r = unescapeJsonString('a\\nb')
    expect(r.ok && r.value).toBe('a\nb')
  })

  it('reports a malformed escape', () => {
    expect(unescapeJsonString('"a\\qb"').ok).toBe(false)
  })

  it('round-trips any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = unescapeJsonString(escapeAsJsonString(s, { ascii: false }))
        expect(r.ok && r.value).toBe(s)
      }),
      { numRuns: 300 },
    )
  })
})

describe('ndjsonToArray', () => {
  it('wraps one-object-per-line into an array', () => {
    const out = ndjsonToArray('{"a":1}\n{"a":2}\n')
    expect(JSON.parse(out)).toEqual([{ a: 1 }, { a: 2 }])
  })
})

describe('number issue detection', () => {
  it('gates cheaply on input with no long digit runs', () => {
    expect(mayHaveLossyNumbers('{"a":1,"b":123}')).toBe(false)
    expect(findNumberIssues('{"a":1}')).toEqual([])
  })

  it('flags an int64 id whose value is actually corrupted', () => {
    const hits = findNumberIssues('{"id":1234567890123456789}')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe('precision')
    expect(hits[0]?.literal).toBe('1234567890123456789')
    expect(hits[0]?.printed).toBe('1234567890123456800')
  })

  it('flags int64 maximum as precision loss', () => {
    const hits = findNumberIssues('{"n":9223372036854775807}')
    expect(hits[0]?.kind).toBe('precision')
  })

  it('classifies int64 minimum as reformatted, not precision loss', () => {
    // -9223372036854775808 is exactly -2^63, so the VALUE survives a round
    // trip intact -- but JS prints it as -9223372036854776000. Reporting this
    // as data loss would be wrong; saying nothing would be alarming.
    const hits = findNumberIssues('{"n":-9223372036854775808}')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe('reformatted')
    expect(hits[0]?.printed).toBe('-9223372036854776000')
    expect(BigInt(hits[0]!.literal)).toBe(BigInt(Number(hits[0]!.literal)))
  })

  it('does NOT flag 2^53, which is exactly representable and prints back', () => {
    // Number.isSafeInteger(9007199254740992) is false, so a naive predicate
    // reports a loss that does not exist.
    expect(findNumberIssues('{"n":9007199254740992}')).toEqual([])
  })

  it('flags 2^53 + 1, which genuinely collapses onto 2^53', () => {
    const hits = findNumberIssues('{"n":9007199254740993}')
    expect(hits[0]?.kind).toBe('precision')
    expect(hits[0]?.printed).toBe('9007199254740992')
  })

  it('does not flag a long digit run that round-trips exactly', () => {
    expect(findNumberIssues('{"n":1000000000000000000}')).toEqual([])
  })

  it('classifies every random long integer exactly', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 10n ** 15n, max: 10n ** 24n }), (big) => {
        const literal = big.toString()
        const hits = findNumberIssues(`{"n":${literal}}`)
        const lossy = BigInt(Number(literal)) !== big
        const reformatted = !lossy && String(Number(literal)) !== literal

        if (lossy) expect(hits[0]?.kind).toBe('precision')
        else if (reformatted) expect(hits[0]?.kind).toBe('reformatted')
        else expect(hits).toEqual([])
      }),
      { numRuns: 300 },
    )
  })
})
