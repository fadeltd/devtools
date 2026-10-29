import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { sortKeysDeep, withSortedKeys } from '../json/format.ts'
import { losslessSupported } from '../json/rawjson.ts'
import { parseLines } from '../list/lines.ts'
import { transformForDiff, type TransformResult } from './transform.ts'

function textOf(r: TransformResult): string {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`)
  return r.text
}

const collate = new Intl.Collator(undefined, { numeric: true, sensitivity: 'variant' }).compare
const keyRef = (a: string, b: string) => collate(a, b) || (a < b ? -1 : a > b ? 1 : 0)

const sorted = (s: string) => textOf(transformForDiff(s, 'sort-lines'))
const json = (s: string, lossless = true) => textOf(transformForDiff(s, 'json', { lossless }))

describe('sort-lines', () => {
  it('sorts in natural order', () => {
    expect(sorted('item10\nitem9\nitem1\n')).toBe('item1\nitem9\nitem10\n')
  })

  it('ignores case for ordering, but orders case variants deterministically', () => {
    expect(sorted('b\nA\na\nB\n')).toBe(sorted('B\na\nA\nb\n'))
    expect(sorted('b\na\n')).toBe('a\nb\n')
  })

  it('does not invent a phantom blank line from the trailing newline', () => {
    expect(sorted('b\na\n')).toBe('a\nb\n')
    expect(parseLines(sorted('b\na\n')).lines).toEqual(['a', 'b'])
  })

  it('keeps the presence or absence of a final newline', () => {
    expect(sorted('b\na')).toBe('a\nb')
    expect(sorted('b\na\n')).toBe('a\nb\n')
  })

  it('keeps CRLF and never leaves a \\r glued to a line', () => {
    expect(sorted('b\r\na\r\n')).toBe('a\r\nb\r\n')
    expect(sorted('b\ra\r')).toBe('a\rb\r')
  })

  it('normalises mixed endings to LF and says so', () => {
    const r = transformForDiff('b\r\na\n', 'sort-lines')
    expect(r).toEqual({ ok: true, text: 'a\nb\n', notes: ['Mixed line endings were normalised to LF.'] })
  })

  it('keeps a byte-order mark at the front', () => {
    expect(sorted('﻿b\na\n')).toBe('﻿a\nb\n')
  })

  it('handles empty input and a lone newline', () => {
    expect(sorted('')).toBe('')
    expect(sorted('\n')).toBe('\n')
  })

  it('sorts blank lines with everything else', () => {
    expect(sorted('b\n\na\n')).toBe('\na\nb\n')
  })

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = sorted(s)
        expect(sorted(once)).toBe(once)
      }),
    )
  })

  it('preserves the multiset of lines', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ unit: 'grapheme' }).map((l) => l.replace(/[\r\n]/g, ''))), (lines) => {
        const out = parseLines(sorted(lines.join('\n'))).lines
        const before = parseLines(lines.join('\n')).lines
        expect(out.toSorted()).toEqual(before.toSorted())
      }),
    )
  })

  it('depends only on the multiset, not the input order', () => {
    const line = fc.string({ unit: 'grapheme-ascii' }).map((l) => l.replace(/[\r\n]/g, ''))
    fc.assert(
      fc.property(fc.array(line, { minLength: 1 }), fc.integer(), (lines, seed) => {
        const shuffled = lines
          .map((l, i) => ({ l, k: Math.sin(seed + i) }))
          .toSorted((a, b) => a.k - b.k)
          .map((x) => x.l)
        expect(sorted(shuffled.join('\n') + '\n')).toBe(sorted(lines.join('\n') + '\n'))
      }),
    )
  })

  it('never reports a failure', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        expect(transformForDiff(s, 'sort-lines').ok).toBe(true)
      }),
    )
  })
})

describe('json', () => {
  it('sorts keys deeply and indents by two spaces', () => {
    expect(json('{"b":1,"a":{"d":[3,1],"c":null}}')).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": [\n      3,\n      1\n    ]\n  },\n  "b": 1\n}\n',
    )
  })

  it('never reorders arrays', () => {
    expect(JSON.parse(json('[3,1,2]'))).toEqual([3, 1, 2])
  })

  it('makes key order and formatting irrelevant', () => {
    expect(json('{"a":1,"b":[true,false]}')).toBe(json('{\n\t"b": [ true, false ],\n\t"a": 1\n}'))
  })

  it('leaves an empty side empty', () => {
    expect(transformForDiff('', 'json')).toEqual({ ok: true, text: '', notes: [] })
    expect(transformForDiff('  \n', 'json')).toEqual({ ok: true, text: '  \n', notes: [] })
  })

  it('accepts comments and trailing commas, and says they were removed', () => {
    const r = transformForDiff('{\n  // why\n  "b": 1,\n  "a": 2,\n}', 'json')
    expect(r).toEqual({
      ok: true,
      text: '{\n  "a": 2,\n  "b": 1\n}\n',
      notes: ['Comments and trailing commas were removed.'],
    })
  })

  it('reports invalid JSON with a line and column', () => {
    const r = transformForDiff('{\n  "a": 1\n  "b": 2\n}', 'json')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/^Expected a comma between items at line 3, column 3$/)
  })

  it('points at an unquoted key', () => {
    const r = transformForDiff('{a: 1}', 'json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('line 1, column 2')
  })

  it('recognises NDJSON as not a single document', () => {
    const r = transformForDiff('{"a":1}\n{"a":2}\n', 'json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('NDJSON')
  })

  it.runIf(losslessSupported)('keeps big integers exactly where the platform allows', () => {
    const r = transformForDiff('{"id":12345678901234567890,"n":1}', 'json')
    expect(r).toEqual({ ok: true, text: '{\n  "id": 12345678901234567890,\n  "n": 1\n}\n', notes: [] })
  })

  it('without lossless parsing, says how many numbers were rounded or reprinted', () => {
    const r = transformForDiff('[12345678901234567890, 98765432109876543210, -9223372036854775808]', 'json', {
      lossless: false,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.notes).toEqual([
      '2 numbers are too large for this browser to keep exactly and may have been rounded.',
      '1 number is printed differently, with the same value.',
    ])
  })

  it('is idempotent on arbitrary JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.boolean(), (v, lossless) => {
        const once = json(JSON.stringify(v), lossless)
        expect(json(once, lossless)).toBe(once)
      }),
    )
  })

  it('is idempotent with big integers', () => {
    const big = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }).map(String)
    fc.assert(
      fc.property(fc.array(big), fc.boolean(), (nums, lossless) => {
        const once = json(`{"z":[${nums.join(',')}],"a":0}`, lossless)
        expect(json(once, lossless)).toBe(once)
      }),
    )
  })

  it('re-parses to the key-sorted input value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const input = JSON.stringify(v)
        const out = json(input)
        // Stringify both sides so key order is compared, not just structure.
        expect(JSON.stringify(JSON.parse(out))).toBe(JSON.stringify(sortKeysDeep(JSON.parse(input), keyRef)))
        // Which is the JSON tool's key sort, up to the tie-break.
        expect(JSON.parse(out)).toEqual(withSortedKeys(JSON.parse(input)))
      }),
    )
  })

  it('makes any key order produce the same text', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).toReversed())
        expect(json(JSON.stringify(reversed))).toBe(json(JSON.stringify(obj)))
      }),
    )
  })
})
