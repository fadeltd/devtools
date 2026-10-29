import { describe, expect, it } from 'vitest'
import { inferColumnTypes, valueType } from './infer.ts'
import { formatTable, jsonKeys, quoteField, toDelimited, toJson, toMarkdown } from './serialize.ts'

describe('quoteField', () => {
  it('quotes only when needed', () => {
    expect(quoteField('plain', ',')).toBe('plain')
    expect(quoteField('a,b', ',')).toBe('"a,b"')
    expect(quoteField('a,b', '\t')).toBe('a,b')
    expect(quoteField('a\tb', '\t')).toBe('"a\tb"')
    expect(quoteField('say "hi"', ',')).toBe('"say ""hi"""')
    expect(quoteField('two\nlines', ';')).toBe('"two\nlines"')
    expect(quoteField('cr\r', '|')).toBe('"cr\r"')
    expect(quoteField('﻿x', ',')).toBe('"﻿x"')
  })
})

describe('toDelimited', () => {
  it('writes the header first and ends with a newline', () => {
    expect(toDelimited({ header: ['a', 'b'], rows: [['1', '2,3']] }, ',')).toBe('a,b\n1,"2,3"\n')
  })

  it('converts semicolon CSV to TSV', () => {
    expect(toDelimited({ header: null, rows: [['1,50', 'x']] }, '\t')).toBe('1,50\tx\n')
  })

  it('writes a lone empty field as "" so it is not read back as a blank line', () => {
    expect(toDelimited({ header: null, rows: [['a'], [''], ['b']] }, ',')).toBe('a\n""\nb\n')
  })

  it('supports CRLF', () => {
    expect(toDelimited({ header: null, rows: [['a'], ['b']] }, ',', '\r\n')).toBe('a\r\nb\r\n')
  })

  it('is empty for an empty table', () => {
    expect(toDelimited({ header: null, rows: [] }, ',')).toBe('')
  })
})

describe('jsonKeys', () => {
  it('names empty columns and de-duplicates repeats', () => {
    expect(jsonKeys(['id', '', 'name', 'name', 'name_2'])).toEqual([
      'id',
      'field2',
      'name',
      'name_2',
      'name_2_2',
    ])
  })
})

describe('toJson', () => {
  it('writes objects with the header as keys, values as exact strings', () => {
    const out = toJson({ header: ['id', 'price'], rows: [['007', '1,50']] })
    expect(JSON.parse(out)).toEqual([{ id: '007', price: '1,50' }])
  })

  it('keeps column order even for integer-like keys', () => {
    const out = toJson({ header: ['name', '2024', '2023'], rows: [['a', '1', '2']] })
    expect(Object.keys(JSON.parse(out)[0] as object)).toEqual(['2023', '2024', 'name'])
    // The text itself is in column order, which is what the user copies.
    expect(out.indexOf('"name"')).toBeLessThan(out.indexOf('"2024"'))
    expect(out.indexOf('"2024"')).toBeLessThan(out.indexOf('"2023"'))
  })

  it('writes arrays when there is no header', () => {
    expect(JSON.parse(toJson({ header: null, rows: [['a', 'b']] }))).toEqual([['a', 'b']])
  })

  it('escapes what JSON needs escaped, and handles __proto__', () => {
    const out = toJson({ header: ['__proto__', 'q'], rows: [['x', 'say "hi"\n']] })
    const parsed = JSON.parse(out) as Record<string, string>[]
    expect(Object.hasOwn(parsed[0]!, '__proto__')).toBe(true)
    expect(parsed[0]!.q).toBe('say "hi"\n')
  })

  it('is [] for no rows', () => {
    expect(toJson({ header: ['a'], rows: [] })).toBe('[]')
  })
})

describe('toMarkdown', () => {
  it('escapes pipes and newlines', () => {
    const md = toMarkdown({ header: ['a|b', 'c'], rows: [['x|y', 'line1\nline2']] })
    expect(md).toContain('a\\|b')
    expect(md).toContain('x\\|y')
    expect(md).toContain('line1<br>line2')
    expect(md.trimEnd().split('\n')).toHaveLength(3)
  })

  it('escapes a backslash before a pipe so the pipe stays escaped', () => {
    expect(toMarkdown({ header: ['h'], rows: [['a\\|b']] })).toContain('a\\\\\\|b')
  })

  it('names columns when there is no header', () => {
    const md = toMarkdown({ header: null, rows: [['1', '2']] })
    expect(md.split('\n')[0]).toBe('| Column 1 | Column 2 |')
  })

  it('pads columns and right-aligns numbers', () => {
    const md = toMarkdown({ header: ['name', 'n'], rows: [['ann', '7'], ['bob', '12']] }, ['text', 'number'])
    expect(md).toBe(
      ['| name |   n |', '| ---- | --: |', '| ann  |   7 |', '| bob  |  12 |', ''].join('\n'),
    )
  })

  it('is empty for an empty table', () => {
    expect(toMarkdown({ header: null, rows: [] })).toBe('')
  })
})

describe('formatTable', () => {
  it('dispatches to each writer', () => {
    const t = { header: ['a'], rows: [['1']] }
    expect(formatTable(t, 'csv')).toBe('a\n1\n')
    expect(formatTable(t, 'tsv')).toBe('a\n1\n')
    expect(formatTable(t, 'json')).toContain('"a": "1"')
    expect(formatTable(t, 'markdown')).toContain('| a   |')
  })
})

describe('type hints', () => {
  it('classifies single values', () => {
    expect(valueType('42')).toBe('number')
    expect(valueType('-3.5e2')).toBe('number')
    expect(valueType('1,50')).toBe('number')
    expect(valueType('1,234,567.89')).toBe('number')
    expect(valueType('TRUE')).toBe('boolean')
    expect(valueType('no')).toBe('boolean')
    expect(valueType('2024-01-15')).toBe('date')
    expect(valueType('2024-01-15T10:30:00Z')).toBe('date')
    expect(valueType('15/01/2024')).toBe('date')
    expect(valueType('1.5.24')).toBe('date')
    expect(valueType('hello')).toBe('text')
    expect(valueType('1.2.3')).toBe('text')
  })

  it('agrees per column, ignoring empty cells', () => {
    const rows = [
      ['1', 'true', '2024-01-01', 'x', ''],
      ['', 'false', '2024-02-01', '2', ''],
      ['3.5', 'yes', '', 'y', ''],
    ]
    expect(inferColumnTypes(rows, 5)).toEqual(['number', 'boolean', 'date', 'text', 'empty'])
  })

  it('reads only the sample', () => {
    const rows = [['1'], ['2'], ['text']]
    expect(inferColumnTypes(rows, 1, 2)).toEqual(['number'])
  })
})
