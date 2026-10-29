import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MAX_ISSUES, parseCsv, sniffDelimiter, tokenize, type Delimiter } from './parse.ts'
import { toDelimited } from './serialize.ts'

const rows = (text: string, delimiter: Delimiter = ',') => tokenize(text, delimiter).records

describe('RFC 4180 examples (section 2)', () => {
  it('1: records end with CRLF', () => {
    expect(rows('aaa,bbb,ccc\r\nzzz,yyy,xxx\r\n')).toEqual([
      ['aaa', 'bbb', 'ccc'],
      ['zzz', 'yyy', 'xxx'],
    ])
  })

  it('2: the last record may omit the line break', () => {
    expect(rows('aaa,bbb,ccc\r\nzzz,yyy,xxx')).toEqual([
      ['aaa', 'bbb', 'ccc'],
      ['zzz', 'yyy', 'xxx'],
    ])
  })

  it('3: an optional header line', () => {
    const t = parseCsv('field_name,field_name2,field_name3\r\naaa,bbb,ccc\r\n', { delimiter: ',' })
    expect(t.header).toEqual(['field_name', 'field_name2', 'field_name3'])
    expect(t.rows).toEqual([['aaa', 'bbb', 'ccc']])
  })

  it('4: spaces are part of a field', () => {
    expect(rows(' aaa , bbb ')).toEqual([[' aaa ', ' bbb ']])
  })

  it('5: fields may be quoted', () => {
    expect(rows('"aaa","bbb","ccc"\r\nzzz,yyy,xxx')).toEqual([
      ['aaa', 'bbb', 'ccc'],
      ['zzz', 'yyy', 'xxx'],
    ])
  })

  it('6: quoted fields hold line breaks and delimiters', () => {
    expect(rows('"aaa","b\r\nbb","c,cc"\r\nzzz,yyy,xxx')).toEqual([
      ['aaa', 'b\r\nbb', 'c,cc'],
      ['zzz', 'yyy', 'xxx'],
    ])
  })

  it('7: a doubled quote inside quotes is one quote', () => {
    expect(rows('"aaa","b""bb","ccc"')).toEqual([['aaa', 'b"bb', 'ccc']])
    expect(rows('""""')).toEqual([['"']])
    expect(rows('"",x')).toEqual([['', 'x']])
  })
})

describe('line endings and edges', () => {
  it('reads LF, CRLF and lone CR alike', () => {
    const want = [
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]
    expect(rows('a,b\nc,d\ne,f')).toEqual(want)
    expect(rows('a,b\r\nc,d\r\ne,f\r\n')).toEqual(want)
    expect(rows('a,b\rc,d\re,f\r')).toEqual(want)
    expect(rows('a,b\r\nc,d\re,f\n')).toEqual(want)
  })

  it('never leaves a \\r glued to a field', () => {
    expect(rows('a,b\r\n').flat()).toEqual(['a', 'b'])
  })

  it('does not invent a row from a trailing newline', () => {
    expect(rows('a,b\n')).toHaveLength(1)
    expect(rows('a,b\r\n')).toHaveLength(1)
  })

  it('reads a trailing delimiter as an empty last field', () => {
    expect(rows('a,\nb,')).toEqual([
      ['a', ''],
      ['b', ''],
    ])
  })

  it('handles empty input', () => {
    const t = parseCsv('')
    expect(t.rows).toEqual([])
    expect(t.header).toBeNull()
    expect(t.columns).toBe(0)
    expect(t.issues).toEqual([])
  })

  it('skips blank lines in a multi-column file, and counts them', () => {
    const t = tokenize('a,b\n\n\r\nc,d\n', ',')
    expect(t.records).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(t.blankLines).toBe(2)
  })

  it('keeps blank lines as empty values in a one-column file', () => {
    expect(rows('a\n\nb\n')).toEqual([['a'], [''], ['b']])
  })

  it('keeps a quote inside an unquoted field', () => {
    expect(rows(`5'10",tall`)).toEqual([[`5'10"`, 'tall']])
  })
})

describe('BOM', () => {
  it('is stripped and reported', () => {
    const t = parseCsv('﻿name,age\nann,3', { delimiter: 'auto' })
    expect(t.bom).toBe(true)
    expect(t.header).toEqual(['name', 'age'])
    expect(t.rows).toEqual([['ann', '3']])
  })

  it('keeps offsets pointing into the original text', () => {
    const input = '﻿a,b\n"x,y'
    const t = parseCsv(input, { delimiter: ',', header: false })
    const issue = t.issues.find((i) => i.kind === 'unterminated-quote')!
    expect(input[issue.offset]).toBe('"')
  })
})

describe('malformed quotes', () => {
  it('reports an unterminated quote at its position and keeps parsing', () => {
    const input = 'a,b\nc,"d\ne,f\n'
    const t = parseCsv(input, { delimiter: ',', header: false })
    const issue = t.issues[0]!
    expect(issue).toMatchObject({ kind: 'unterminated-quote', line: 2, column: 3, row: 2 })
    expect(input[issue.offset]).toBe('"')
    // The quote is literal, so the rest still splits into rows.
    expect(t.rows).toEqual([
      ['a', 'b'],
      ['c', '"d'],
      ['e', 'f'],
    ])
  })

  it('stays linear when an unterminated quote is followed by quote pairs', () => {
    const input = '"x,' + '"",'.repeat(50_000)
    const start = performance.now()
    const t = tokenize(input, ',')
    expect(performance.now() - start).toBeLessThan(1000)
    expect(t.records[0]![0]).toBe('"x')
    expect(t.issues[0]!.kind).toBe('unterminated-quote')
  })

  it('keeps text after a closing quote, and reports it', () => {
    const t = tokenize('"a"b,c', ',')
    expect(t.records).toEqual([['ab', 'c']])
    expect(t.issues[0]).toMatchObject({ kind: 'text-after-quote', line: 1, column: 4 })
  })

  it('reports line numbers past quoted newlines', () => {
    const t = tokenize('"a\nb",c\n"d\r\ne",f\n"g"h', ',')
    expect(t.issues[0]).toMatchObject({ kind: 'text-after-quote', line: 5, column: 4 })
  })
})

describe('ragged rows', () => {
  it('reports each ragged row with expected vs got, and pads', () => {
    const t = parseCsv('a,b,c\n1,2\n3,4,5\n6\n', { delimiter: ',', header: true })
    expect(t.columns).toBe(3)
    expect(t.rows).toEqual([
      ['1', '2', ''],
      ['3', '4', '5'],
      ['6', '', ''],
    ])
    expect(t.issues.map((i) => [i.kind, i.row, i.line, i.expected, i.got])).toEqual([
      ['ragged', 1, 2, 3, 2],
      ['ragged', 3, 4, 3, 1],
    ])
  })

  it('widens the table rather than drop extra cells', () => {
    const t = parseCsv('a,b\n1,2,3\n', { delimiter: ',', header: true })
    expect(t.columns).toBe(3)
    expect(t.header).toEqual(['a', 'b', ''])
    expect(t.rows).toEqual([['1', '2', '3']])
    expect(t.issues[0]).toMatchObject({ kind: 'ragged', row: 1, expected: 2, got: 3 })
  })

  it('numbers rows from 1 when there is no header', () => {
    const t = parseCsv('a,b\n1\n', { delimiter: ',', header: false })
    expect(t.issues[0]).toMatchObject({ row: 2, line: 2 })
  })

  it('caps stored issues but counts all of them', () => {
    const input = 'a,b\n' + '1\n'.repeat(MAX_ISSUES + 5)
    const t = parseCsv(input, { delimiter: ',' })
    expect(t.issues).toHaveLength(MAX_ISSUES)
    expect(t.issueCount).toBe(MAX_ISSUES + 5)
  })
})

describe('header', () => {
  it('reports repeated column names first', () => {
    const t = parseCsv('id,name,name\n1\n', { delimiter: ',' })
    expect(t.issues.map((i) => i.kind)).toEqual(['duplicate-header', 'ragged'])
    expect(t.issues[0]!.message).toContain('Column 3')
  })

  it('a header-only file has no rows', () => {
    const t = parseCsv('a,b\n', { delimiter: ',' })
    expect(t.header).toEqual(['a', 'b'])
    expect(t.rows).toEqual([])
  })
})

describe('sniffDelimiter', () => {
  it('picks comma, tab, semicolon and pipe', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n')).toEqual({ delimiter: ',', confident: true })
    expect(sniffDelimiter('a\tb\n1\t2\n').delimiter).toBe('\t')
    expect(sniffDelimiter('a;b\n1;2\n').delimiter).toBe(';')
    expect(sniffDelimiter('a|b\n1|2\n').delimiter).toBe('|')
  })

  it('picks semicolon in European CSV with decimal commas', () => {
    const eu = 'Produkt;Preis;Menge\nÄpfel;1,50;3\nBirnen;2,25;10\nKirschen;12,00;1\n'
    expect(sniffDelimiter(eu).delimiter).toBe(';')
    const t = parseCsv(eu)
    expect(t.delimiter).toBe(';')
    expect(t.detected).toBe(true)
    expect(t.rows[0]).toEqual(['Äpfel', '1,50', '3'])
  })

  it('prefers semicolon when every row also splits evenly on commas', () => {
    expect(sniffDelimiter('1,5;2,5\n3,5;4,5\n').delimiter).toBe(';')
  })

  it('is not fooled by delimiters inside quotes', () => {
    const text = 'name,notes\n"a","x;y;z"\n"b","p;q;r"\n"c","m;n;o"\n'
    expect(sniffDelimiter(text).delimiter).toBe(',')
  })

  it('reads a quoted newline as part of the field, not a new record', () => {
    expect(sniffDelimiter('a;b\n"multi\nline";2\nc;3\n').delimiter).toBe(';')
  })

  it('falls back to comma, unconfident, for a single column', () => {
    expect(sniffDelimiter('just\none\ncolumn\n')).toEqual({ delimiter: ',', confident: false })
  })

  it('ignores a BOM', () => {
    expect(sniffDelimiter('﻿a;b\n1;2').delimiter).toBe(';')
  })

  it('a manual delimiter overrides sniffing', () => {
    const t = parseCsv('a;b,c\n1;2,3\n', { delimiter: ',' })
    expect(t.detected).toBe(false)
    expect(t.header).toEqual(['a;b', 'c'])
  })
})

describe('round trip: parse → serialise → parse', () => {
  const cell = fc.string({
    unit: fc.constantFrom('a', 'Z', '1', ' ', ',', ';', '|', '\t', '"', '\n', '\r', 'é', '🎉', '﻿'),
    maxLength: 6,
  })
  const table = fc
    .integer({ min: 1, max: 5 })
    .chain((w) => fc.array(fc.array(cell, { minLength: w, maxLength: w }), { maxLength: 12 }))
  const delimiter = fc.constantFrom<Delimiter>(',', '\t', ';', '|')

  it('returns the same rows for any rectangular table', () => {
    fc.assert(
      fc.property(table, delimiter, (data, d) => {
        const text = toDelimited({ header: null, rows: data }, d)
        const back = parseCsv(text, { delimiter: d, header: false })
        expect(back.rows).toEqual(data)
        expect(back.issueCount).toBe(0)
      }),
      { numRuns: 500 },
    )
  })

  it('is stable on any input, malformed or not', () => {
    const text = fc.string({
      unit: fc.constantFrom('a', ',', ';', '"', '\n', '\r', ' '),
      maxLength: 60,
    })
    fc.assert(
      fc.property(text, delimiter, (input, d) => {
        const once = parseCsv(input, { delimiter: d, header: false })
        const twice = parseCsv(toDelimited(once, d), { delimiter: d, header: false })
        expect(twice.rows).toEqual(once.rows)
      }),
      { numRuns: 500 },
    )
  })
})
