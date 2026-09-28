import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  applyEdits,
  fixBom,
  fixComments,
  fixJsonp,
  fixSingleQuotes,
  fixTrailingCommas,
  fixUnquotedKeys,
  fixXssi,
  runFixes,
  type TextEdit,
} from './fixes'

const apply = (text: string, find: (t: string) => TextEdit[]) => applyEdits(text, find(text))

describe('applyEdits', () => {
  it('applies in offset order regardless of input order', () => {
    expect(
      applyEdits('abcdef', [
        { offset: 4, length: 1, content: 'E' },
        { offset: 0, length: 2, content: '' },
      ]),
    ).toBe('cdEf')
  })

  it('refuses overlapping edits', () => {
    expect(() =>
      applyEdits('abc', [
        { offset: 0, length: 2, content: '' },
        { offset: 1, length: 1, content: '' },
      ]),
    ).toThrow()
  })
})

describe('individual fixes', () => {
  it('removes a BOM', () => {
    expect(apply('\uFEFF{"a":1}', fixBom)).toBe('{"a":1}')
    expect(fixBom('{}')).toEqual([])
  })

  it("strips the )]}' XSSI prefix, with or without a comma", () => {
    expect(apply(")]}'\n{\"a\":1}", fixXssi)).toBe('{"a":1}')
    expect(apply(")]}',\r\n[1]", fixXssi)).toBe('[1]')
    expect(fixXssi('[")]}\'"]')).toEqual([])
  })

  it('strips a JSONP wrapper', () => {
    expect(apply('cb({"a":1});', fixJsonp)).toBe('{"a":1}')
    expect(apply('/**/ jQuery.cb_1 ( [1,2] )\n', fixJsonp)).toBe('[1,2]')
    expect(fixJsonp('cb(42)')).toEqual([])
    expect(fixJsonp('{"a":"cb("}')).toEqual([])
  })

  it('removes comments but not comment-like text in strings', () => {
    expect(apply('{"u":"http://x", // note\n"b":/* c */1}', fixComments)).toBe(
      '{"u":"http://x", \n"b":1}',
    )
    expect(fixComments('{"a":"/* no */"}')).toEqual([])
  })

  it('takes a comment-only line with it', () => {
    expect(apply('{\n  // note\n  "a": 1 // trailing\n}', fixComments)).toBe('{\n  "a": 1 \n}')
    expect(apply('[\r\n  /* x */\r\n  1]', fixComments)).toBe('[\r\n  1]')
  })

  it('converts single-quoted strings, escaping and unescaping quotes', () => {
    expect(apply("{'a': 'it\\'s \"x\"'}", fixSingleQuotes)).toBe('{"a": "it\'s \\"x\\""}')
    expect(apply("['\\n']", fixSingleQuotes)).toBe('["\\n"]')
    expect(fixSingleQuotes('{"a":"don\'t"}')).toEqual([])
  })

  it('quotes bare keys only in key position', () => {
    expect(apply('{a: 1, $b_2 : true, "c": x}', fixUnquotedKeys)).toBe(
      '{"a": 1, "$b_2" : true, "c": x}',
    )
    expect(apply('{\n  // c\n  a: 1}', fixUnquotedKeys)).toBe('{\n  // c\n  "a": 1}')
    expect(fixUnquotedKeys('[true, null]')).toEqual([])
  })

  it('removes trailing commas, looking past comments', () => {
    expect(apply('{"a":[1,2,],}', fixTrailingCommas)).toBe('{"a":[1,2]}')
    expect(apply('[1, // x\n]', fixTrailingCommas)).toBe('[1 // x\n]')
    expect(fixTrailingCommas('{"a":","}')).toEqual([])
  })
})

describe('runFixes', () => {
  it('fixes a pasted JS object literal end to end', () => {
    const src = `\uFEFFcallback({
      // user record
      id: 7,
      name: 'O\\'Brien',
      tags: ['a', 'b',],
    });`
    const { text, applied } = runFixes(src)
    expect(JSON.parse(text)).toEqual({ id: 7, name: "O'Brien", tags: ['a', 'b'] })
    expect(applied.map((a) => [a.id, a.count])).toEqual([
      ['bom', 1],
      ['jsonp', 1],
      ['comments', 1],
      ['singleQuotes', 3],
      ['unquotedKeys', 3],
      ['trailingCommas', 2],
    ])
    expect(applied.find((a) => a.id === 'unquotedKeys')?.label).toBe('Quote 3 bare keys')
  })

  it('handles the XSSI prefix before anything else reads it as a string', () => {
    expect(runFixes(")]}'\n{a:1}").text).toBe('{"a":1}')
  })
})

/** Serialise like a sloppy JS literal: bare keys, single quotes, trailing commas, comments. */
function sloppy(v: unknown): string {
  if (typeof v === 'string') {
    // Reuse JSON's escaping, then swap the quote style.
    const body = JSON.stringify(v).slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'")
    return `'${body}'`
  }
  if (Array.isArray(v)) return `[${v.map(sloppy).join(', ')}${v.length ? ',' : ''}]`
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v).map(([k, x]) =>
      /^[A-Za-z_$][\w$]*$/.test(k) ? `${k}: ${sloppy(x)}` : `${sloppy(k)}: ${sloppy(x)}`,
    )
    return `{ /* obj */ ${entries.join(',\n // item\n')}${entries.length ? ',' : ''} }`
  }
  return JSON.stringify(v)
}

describe('properties', () => {
  const value = fc.jsonValue({ maxDepth: 3 }).map((v) => JSON.parse(JSON.stringify(v)) as unknown)

  it('changes nothing in valid JSON', () => {
    fc.assert(
      fc.property(value, fc.constantFrom(0, 2), (v, indent) => {
        const text = JSON.stringify(v, null, indent)
        expect(runFixes(text)).toEqual({ text, applied: [] })
      }),
    )
  })

  it('repairs a sloppy literal to the same value', () => {
    fc.assert(
      fc.property(value, (v) => {
        expect(JSON.parse(runFixes(sloppy(v)).text)).toEqual(v)
      }),
    )
  })
})
