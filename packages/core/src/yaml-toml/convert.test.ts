import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { parse as parseToml } from 'smol-toml'
import { parse as parseYaml } from 'yaml'
import { convert, type Format } from './index.ts'
import { guessFormat } from './read.ts'
import { stringifyJson } from './write.ts'

const FIXTURE = {
  title: 'Example',
  enabled: true,
  ratio: 0.75,
  ports: [8001, 8002],
  owner: { name: 'Tom', tags: ['a', 'b'] },
  database: {
    server: '192.168.1.1',
    limits: { max: 5000, nested: { deep: 'yes' } },
  },
  servers: [
    { name: 'alpha', ip: '10.0.0.1', roles: ['web'] },
    { name: 'beta', ip: '10.0.0.2', roles: ['db', 'cache'] },
  ],
  matrix: [
    [1, 2],
    [3, 4],
  ],
}

/** Parse each format to plain data, with every integer as a number. */
function data(text: string, format: Format): unknown {
  if (format === 'json') return JSON.parse(text)
  if (format === 'yaml') return parseYaml(text)
  return JSON.parse(JSON.stringify(parseToml(text)))
}

const FORMATS: Format[] = ['json', 'yaml', 'toml']

function ok(input: string, from: Format | 'auto', to: Format, o = {}) {
  const r = convert(input, from, to, o)
  expect(r.errors).toEqual([])
  return r
}

describe('round-trips', () => {
  const sources: Record<Format, string> = {
    json: JSON.stringify(FIXTURE, null, 2),
    yaml: '',
    toml: '',
  }
  sources.yaml = ok(sources.json, 'json', 'yaml').output
  sources.toml = ok(sources.json, 'json', 'toml').output

  for (const from of FORMATS) {
    for (const to of FORMATS) {
      if (from === to) continue
      it(`${from} → ${to} → ${from} keeps the data`, () => {
        const there = ok(sources[from], from, to)
        expect(data(there.output, to)).toEqual(FIXTURE)
        const back = ok(there.output, to, from)
        expect(data(back.output, from)).toEqual(FIXTURE)
      })
    }
  }

  it('writes arrays of tables and nested tables in TOML', () => {
    const toml = sources.toml
    expect(toml).toContain('[[servers]]')
    expect(toml).toContain('[database.limits.nested]')
  })

  it('reads inline tables and arrays of tables from TOML', () => {
    const r = ok('point = { x = 1, y = 2 }\n[[fruit]]\nname = "apple"\n[[fruit]]\nname = "pear"\n', 'toml', 'json')
    expect(JSON.parse(r.output)).toEqual({ point: { x: 1, y: 2 }, fruit: [{ name: 'apple' }, { name: 'pear' }] })
  })

  it('keeps TOML floats and integers apart through YAML', () => {
    const yaml = ok('f = 1.0\ni = 1\n', 'toml', 'yaml').output
    expect(yaml).toBe('f: 1.0\ni: 1\n')
    expect(ok(yaml, 'yaml', 'toml').output).toBe('f = 1.0\ni = 1\n')
  })
})

describe('YAML specifics', () => {
  it('keeps the Norway problem a string, and says why', () => {
    const r = ok('country: no\nflag: on\nreal: false\n', 'yaml', 'json')
    expect(JSON.parse(r.output)).toEqual({ country: 'no', flag: 'on', real: false })
    const note = r.notes.find((n) => n.code === 'yaml11-bool')
    expect(note?.message).toContain('no (line 1)')
    expect(note?.line).toBe(1)
    expect(note?.column).toBe(10)
  })

  it('quotes Norway-problem strings in YAML output so 1.1 readers agree', () => {
    const r = ok('{"country": "no", "mode": "0755", "port": "22:22"}', 'json', 'yaml')
    expect(r.output).toBe('country: "no"\nmode: "0755"\nport: "22:22"\n')
  })

  it('notes leading-zero octals and base-60 numbers', () => {
    const r = ok('mode: 0755\nport: 22:22\n', 'yaml', 'json')
    expect(JSON.parse(r.output)).toEqual({ mode: 755, port: '22:22' })
    expect(r.notes.map((n) => n.code)).toEqual(
      expect.arrayContaining(['yaml11-octal', 'yaml11-sexagesimal']),
    )
  })

  it('respects an explicit %YAML 1.1 directive', () => {
    const r = ok('%YAML 1.1\n---\ncountry: no\n', 'yaml', 'json')
    expect(JSON.parse(r.output)).toEqual({ country: false })
    expect(r.notes.some((n) => n.code === 'yaml-1.1-directive')).toBe(true)
  })

  const MULTI = 'a: 1\n---\nb: 2\n---\n- x\n'

  it('converts a multi-document stream to a JSON array', () => {
    const r = ok(MULTI, 'yaml', 'json')
    expect(r.documents).toBe(3)
    expect(JSON.parse(r.output)).toEqual([{ a: 1 }, { b: 2 }, ['x']])
    expect(r.notes.some((n) => n.code === 'multi-doc-array')).toBe(true)
  })

  it('converts one picked document', () => {
    expect(JSON.parse(ok(MULTI, 'yaml', 'json', { document: 1 }).output)).toEqual({ b: 2 })
    expect(ok(MULTI, 'yaml', 'toml', { document: 1 }).output).toBe('b = 2\n')
    expect(ok(MULTI, 'yaml', 'yaml', { document: 2 }).output).toBe('---\n- x\n')
  })

  it('refuses a multi-document stream to TOML without a pick', () => {
    const r = convert(MULTI, 'yaml', 'toml')
    expect(r.errors[0]?.code).toBe('toml-multi-doc')
    expect(r.output).toBe('')
  })

  it('resolves anchors, aliases and merge keys, with a note', () => {
    const r = ok('base: &b {x: 1}\ncopy: *b\nm:\n  <<: *b\n  y: 2\n', 'yaml', 'json')
    expect(JSON.parse(r.output)).toEqual({ base: { x: 1 }, copy: { x: 1 }, m: { x: 1, y: 2 } })
    expect(r.notes.map((n) => n.code)).toEqual(
      expect.arrayContaining(['yaml-aliases-resolved', 'yaml-merge-resolved']),
    )
  })

  it('refuses an alias bomb instead of expanding it', () => {
    const rows = ['a: &a [x,x,x,x,x,x,x,x,x]']
    for (const [n, p] of [['b', 'a'], ['c', 'b'], ['d', 'c'], ['e', 'd']] as const) {
      rows.push(`${n}: &${n} [${Array(9).fill(`*${p}`).join(',')}]`)
    }
    const r = convert(rows.join('\n'), 'yaml', 'json')
    expect(r.errors[0]?.code).toBe('yaml-aliases')
  })

  it('treats a custom tag as an error, with its position', () => {
    const r = convert('key: !Ref Foo\nbin: !!binary aGk=\n', 'yaml', 'json')
    expect(r.errors.map((e) => [e.code, e.line, e.column])).toEqual([
      ['yaml-tag', 1, 6],
      ['yaml-tag', 2, 6],
    ])
    expect(r.errors[0]?.message).toContain('!Ref')
    expect(r.errors[1]?.message).toContain('!!binary')
  })

  it('keeps custom tags YAML → YAML, unevaluated', () => {
    const r = ok('key: !Ref Foo\n', 'yaml', 'yaml')
    expect(r.output).toBe('key: !Ref Foo\n')
    expect(r.notes.some((n) => n.code === 'yaml-tags-kept')).toBe(true)
  })

  it('reports duplicate keys with their position', () => {
    const r = convert('a: 1\nb: 2\na: 3\n', 'yaml', 'json')
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatchObject({ code: 'yaml-duplicate_key', line: 3, column: 1 })
    expect(r.errors[0]?.snippet?.caretLine).toBe(3)
  })

  it('keeps comments YAML → YAML and re-indents', () => {
    const r = ok('# top\na:\n    b: 1 # why\n', 'yaml', 'yaml', { indent: 2 })
    expect(r.output).toBe('# top\na:\n  b: 1 # why\n')
  })

  it('notes that comments are dropped elsewhere', () => {
    const r = ok('# top\na: 1\n', 'yaml', 'json')
    expect(r.notes.some((n) => n.code === 'comments-dropped')).toBe(true)
    expect(ok('a: "#fff"\n', 'yaml', 'json').notes.some((n) => n.code === 'comments-dropped')).toBe(false)
  })

  it('treats `__proto__` as an ordinary key', () => {
    const r = ok('__proto__: 1\nk: 2\n', 'yaml', 'json')
    expect(r.output).toBe('{\n  "__proto__": 1,\n  "k": 2\n}')
    expect(({} as Record<string, unknown>).k).toBeUndefined()
  })
})

describe('TOML specifics', () => {
  it('keeps an integer beyond 2^53 exact in JSON, and warns', () => {
    const r = ok('id = 12345678901234567890\nsmall = 9007199254740992\n', 'toml', 'json')
    expect(r.output).toBe('{\n  "id": 12345678901234567890,\n  "small": 9007199254740992\n}')
    const w = r.warnings.find((x) => x.code === 'big-integer')
    expect(w?.message).toContain('.id = 12345678901234567890')
    // 2^53 is held exactly by a double: no warning about it.
    expect(w?.message).toContain('1 integer ')
  })

  it('keeps an exactly-representable integer that prints differently as digits', () => {
    // 2^60 is exact as a double, but String(2 ** 60) is 1152921504606847000.
    const r = ok('n = 1152921504606846976\n', 'toml', 'json', { indent: 'minify' })
    expect(r.output).toBe('{"n":1152921504606846976}')
    expect(r.warnings).toEqual([])
  })

  it('writes datetimes as ISO strings and says so', () => {
    const r = ok('d = 1979-05-27\nt = 1979-05-27T00:32:00-07:00\n', 'toml', 'json')
    expect(JSON.parse(r.output)).toEqual({ d: '1979-05-27', t: '1979-05-27T00:32:00.000-07:00' })
    expect(r.notes.some((n) => n.code === 'dates-as-strings')).toBe(true)
  })

  it('keeps datetimes as datetimes TOML → TOML', () => {
    expect(ok('d = 1979-05-27\n', 'toml', 'toml').output).toBe('d = 1979-05-27\n')
  })

  it('refuses null, naming the key path and pointing at it', () => {
    const r = convert('{\n  "server": {\n    "host": null,\n    "ports": [1, null]\n  }\n}', 'json', 'toml')
    expect(r.output).toBe('')
    expect(r.errors.map((e) => [e.code, e.path, e.line, e.column])).toEqual([
      ['toml-null', '.server.host', 3, 5],
      ['toml-null', '.server.ports[1]', 4, 18],
    ])
  })

  it('points a YAML null at its key', () => {
    const r = convert('a:\n  b:\n', 'yaml', 'toml')
    expect(r.errors[0]).toMatchObject({ code: 'toml-null', path: '.a.b', line: 2, column: 3 })
  })

  it('refuses a non-table root', () => {
    expect(convert('[1, 2]', 'json', 'toml').errors[0]?.code).toBe('toml-root')
  })

  it('writes mixed-type arrays, which TOML 1.0 allows', () => {
    expect(ok('{"m": [1, "a", {"x": 1}]}', 'json', 'toml').output).toBe('m = [ 1, "a", { x = 1 } ]\n')
  })

  it('warns about integers outside 64 bits', () => {
    const r = ok('{"n": 123456789012345678901234567890}', 'json', 'toml')
    expect(r.output).toBe('n = 123456789012345678901234567890\n')
    expect(r.warnings.some((w) => w.code === 'toml-int64')).toBe(true)
  })
})

describe('JSON specifics', () => {
  it('keeps big integers from JSON exact in YAML and TOML', () => {
    const input = '{"id": 12345678901234567890}'
    expect(ok(input, 'json', 'yaml').output).toBe('id: 12345678901234567890\n')
    expect(ok(input, 'json', 'toml').output).toBe('id = 12345678901234567890\n')
    expect(ok(input, 'json', 'json', { indent: 'minify' }).output).toBe('{"id":12345678901234567890}')
  })

  it('formats with 2, 4, tabs or minified', () => {
    const v = '{"a":[1,{"b":2}]}'
    expect(ok(v, 'json', 'json', { indent: 4 }).output).toBe(JSON.stringify(JSON.parse(v), null, 4))
    expect(ok(v, 'json', 'json', { indent: 'tab' }).output).toBe(JSON.stringify(JSON.parse(v), null, '\t'))
    expect(ok(v, 'json', 'json', { indent: 'minify' }).output).toBe(v)
  })

  it('accepts JSONC, with a note', () => {
    const r = ok('{\n  // port\n  "a": 1,\n}', 'json', 'yaml')
    expect(r.output).toBe('a: 1\n')
    expect(r.notes[0]?.code).toBe('jsonc')
  })

  it('warns that NaN cannot be JSON', () => {
    const r = ok('a = nan\n', 'toml', 'json')
    expect(r.output).toBe('{\n  "a": null\n}')
    expect(r.warnings[0]?.code).toBe('json-non-finite')
  })

  it('stringifyJson matches JSON.stringify exactly', () => {
    fc.assert(
      fc.property(
        fc.jsonValue(),
        fc.constantFrom<2 | 4 | 'tab' | 'minify'>(2, 4, 'tab', 'minify'),
        (v, indent) => {
          const gap = indent === 'minify' ? '' : indent === 'tab' ? '\t' : indent
          // Wrap with a bigint to force the hand-written path.
          const ours = stringifyJson([v, 1n], indent)
          expect(ours).toBe(JSON.stringify([v, 1], null, gap))
        },
      ),
    )
  })
})

describe('positioned errors', () => {
  it('JSON', () => {
    const r = convert('{\n  "a": 1,\n  "b": \n}', 'json', 'yaml')
    expect(r.errors[0]).toMatchObject({ line: 4, column: 1 })
    expect(r.errors[0]?.snippet?.caretLine).toBe(4)
  })

  it('TOML', () => {
    const r = convert('a = 1\nb = \n', 'toml', 'json')
    expect(r.errors[0]).toMatchObject({ code: 'toml-parse', line: 2, column: 5 })
    expect(r.errors[0]?.message).not.toContain('Invalid TOML document')
    expect(r.errors[0]?.snippet?.lines.map((l) => l.number)).toEqual([1, 2, 3])
  })

  it('YAML', () => {
    const r = convert('a:\n\tb: 1\n', 'yaml', 'json')
    expect(r.errors[0]).toMatchObject({ code: 'yaml-tab_as_indent', line: 2, column: 1 })
    expect(r.errors[0]?.hint).toContain('spaces')
  })

  it('a caret column counts tabs at their width', () => {
    const r = convert('{\n\t"a": 1,\n}', 'json', 'yaml', { tabWidth: 4 })
    // Lenient JSON accepts the trailing comma; force a real error instead.
    expect(r.errors).toEqual([])
    const bad = convert('{\n\t"a": x\n}', 'json', 'yaml', { tabWidth: 4 })
    expect(bad.errors[0]).toMatchObject({ line: 2, column: 7 })
    expect(bad.errors[0]?.snippet?.caretColumn).toBe(10)
  })

  it('windows a very long line around the caret', () => {
    const input = `{${'"k": 1, '.repeat(5000)}"bad": x}`
    const e = convert(input, 'json', 'yaml').errors[0]!
    const line = e.snippet!.lines[0]!.text
    expect(line.length).toBeLessThan(130)
    expect(line.startsWith('…')).toBe(true)
    // The caret still sits under the offending character.
    expect(line[e.snippet!.caretColumn - 1]).toBe('x')
  })

  it('reports an alias with no anchor, for every target, instead of throwing', () => {
    for (const to of ['yaml', 'json', 'toml'] as const) {
      const r = convert('a: 1\nb: *missing\n', 'yaml', to)
      expect(r.output).toBe('')
      expect(r.errors).toEqual([
        expect.objectContaining({ code: 'yaml-unresolved-alias', line: 2, column: 4 }),
      ])
    }
    // The shrunk counterexample fast-check found: auto-detected as YAML.
    expect(convert('*!', 'auto', 'yaml').errors[0]?.code).toBe('yaml-unresolved-alias')
  })

  it('nothing throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom<Format | 'auto'>('auto', 'json', 'yaml', 'toml'), fc.constantFrom<Format>('json', 'yaml', 'toml'), (s, from, to) => {
        const r = convert(s, from, to)
        expect(typeof r.output).toBe('string')
      }),
    )
  })
})

describe('auto-detection', () => {
  it.each([
    ['a = 1', 'toml'],
    ['a: 1', 'yaml'],
    ['{}', 'json'],
    ['[server]\nport = 8080\n', 'toml'],
    ['- a\n- b\n', 'yaml'],
    ['[1, 2]', 'json'],
    ['big = 12345678901234567890\n', 'toml'],
  ] as const)('%j is %s', (input, format) => {
    expect(ok(input, 'auto', 'json').detected).toBe(format)
  })

  it('shows TOML errors for broken TOML rather than reading it as a YAML string', () => {
    const r = convert('a = 1\nb = \n', 'auto', 'json')
    expect(r.detected).toBe('toml')
    expect(r.errors[0]?.code).toBe('toml-parse')
  })

  it('shows JSON errors for broken JSON', () => {
    const r = convert('{"a": 1 "b": 2}', 'auto', 'yaml')
    expect(r.detected).toBe('json')
    expect(r.errors[0]?.code).toMatch(/^json-/)
  })

  it('guesses from the first meaningful line', () => {
    expect(guessFormat('# c\n\n[a.b]\n')).toBe('toml')
    expect(guessFormat('  {"a"')).toBe('json')
    expect(guessFormat('key: value')).toBe('yaml')
  })

  it('returns nothing for empty input', () => {
    expect(convert('  \n', 'auto', 'json')).toMatchObject({ output: '', detected: null, errors: [] })
  })

  it('ignores a BOM', () => {
    expect(ok('\uFEFF{"a": 1}', 'auto', 'yaml').output).toBe('a: 1\n')
  })
})
