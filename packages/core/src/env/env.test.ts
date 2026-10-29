import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { convertEnv, detectEnvFormat, maskEntries, MASK } from './convert.ts'
import { parseDotenv } from './dotenv.ts'
import { parseJsonEnv } from './json.ts'
import { quoteDotenvValue, serializeEnv, shellQuote, toDockerEnv, toDotenv, toJson, toShell } from './serialize.ts'
import { parseShellExports } from './shell.ts'
import type { EnvDoc, EnvEntry } from './types.ts'

const vars = (doc: EnvDoc) => Object.fromEntries(doc.entries.map((e) => [e.key, e.value]))
const errors = (doc: { issues: EnvDoc['issues'] }) => doc.issues.filter((i) => i.severity === 'error')
const warnings = (doc: { issues: EnvDoc['issues'] }) => doc.issues.filter((i) => i.severity === 'warning')
const entries = (o: Record<string, string>): EnvEntry[] =>
  Object.entries(o).map(([key, value], i) => ({ key, value, line: i + 1 }))

describe('parseDotenv', () => {
  it('reads plain assignments, export, and spaces around =', () => {
    const doc = parseDotenv('A=1\nexport B=two\n  C = three  \nD=\n')
    expect(vars(doc)).toEqual({ A: '1', B: 'two', C: 'three', D: '' })
    expect(doc.issues).toEqual([])
    expect(doc.entries.map((e) => e.line)).toEqual([1, 2, 3, 4])
  })

  it('treats a key named export as a key', () => {
    expect(vars(parseDotenv('export=1'))).toEqual({ export: '1' })
  })

  it('skips full-line comments and blank lines', () => {
    expect(vars(parseDotenv('# top\n\n   # indented\nA=1\n'))).toEqual({ A: '1' })
  })

  it('strips an inline comment after an unquoted value', () => {
    expect(vars(parseDotenv('A=value # note\nB=  # only a comment\nC=#also'))).toEqual({ A: 'value', B: '', C: '' })
  })

  it('keeps # glued to an unquoted value, with a warning about Node dotenv', () => {
    const doc = parseDotenv('PASS=abc#def')
    expect(vars(doc)).toEqual({ PASS: 'abc#def' })
    expect(warnings(doc)).toEqual([expect.objectContaining({ line: 1, message: expect.stringContaining('#') })])
  })

  it('keeps # inside quotes', () => {
    expect(vars(parseDotenv(`A="x # y" # c\nB='x # y'`))).toEqual({ A: 'x # y', B: 'x # y' })
  })

  it('reads single quotes and backticks literally', () => {
    expect(vars(parseDotenv(String.raw`A='a\nb "c" $D'` + '\nB=`it\'s "x"`'))).toEqual({
      A: String.raw`a\nb "c" $D`,
      B: `it's "x"`,
    })
  })

  it('processes escapes in double quotes in one pass', () => {
    const doc = parseDotenv(String.raw`A="l1\nl2\tt \"q\" \\ \\n \$x \r"`)
    expect(vars(doc)).toEqual({ A: 'l1\nl2\tt "q" \\ \\n \\$x \r' })
  })

  it('reads a multiline double-quoted value and numbers lines from its start', () => {
    const doc = parseDotenv('A=1\nKEY="-----BEGIN-----\nabc\n-----END-----"\nB=2')
    expect(vars(doc)).toEqual({ A: '1', KEY: '-----BEGIN-----\nabc\n-----END-----', B: '2' })
    expect(doc.entries.map((e) => [e.key, e.line])).toEqual([
      ['A', 1],
      ['KEY', 2],
      ['B', 5],
    ])
  })

  it('a backslash before a line break inside double quotes does not close the value', () => {
    expect(vars(parseDotenv('A="x\\\ny"'))).toEqual({ A: 'x\\\ny' })
  })

  it('handles CRLF and lone CR without leaving \\r on values', () => {
    const doc = parseDotenv('A=1\r\nB="x\r\ny"\r\nC=3\rD=4\r\n')
    expect(vars(doc)).toEqual({ A: '1', B: 'x\ny', C: '3', D: '4' })
    expect(doc.entries.find((e) => e.key === 'D')?.line).toBe(5)
  })

  it('ignores a BOM', () => {
    expect(vars(parseDotenv('\uFEFFA=1'))).toEqual({ A: '1' })
  })

  it('lets the last duplicate win, keeping the first position, and warns', () => {
    const doc = parseDotenv('A=1\nB=2\nA=3\nA=4')
    expect(doc.entries).toEqual([
      { key: 'A', value: '4', line: 4 },
      { key: 'B', value: '2', line: 2 },
    ])
    expect(warnings(doc).map((w) => w.line)).toEqual([3, 4])
    expect(warnings(doc)[0]!.message).toContain('line 1')
  })

  it('accepts . and - in keys', () => {
    expect(vars(parseDotenv('a.b-c_D=1'))).toEqual({ 'a.b-c_D': '1' })
  })

  describe('errors', () => {
    it('a line without = (and does not echo a non-key line)', () => {
      const doc = parseDotenv('A=1\nFOO\nsk_live 123 secret\nB=2')
      expect(vars(doc)).toEqual({ A: '1', B: '2' })
      expect(errors(doc).map((e) => e.line)).toEqual([2, 3])
      expect(errors(doc)[0]!.message).toContain('FOO=')
      expect(errors(doc)[1]!.message).not.toContain('secret')
    })

    it('an invalid key', () => {
      for (const src of ['1A=x', 'MY KEY=x', 'A$=x', '=x']) {
        const doc = parseDotenv(src)
        expect(doc.entries).toEqual([])
        expect(errors(doc)).toHaveLength(1)
        expect(errors(doc)[0]!.line).toBe(1)
      }
    })

    it('an unterminated quote, recovering on the next line', () => {
      const doc = parseDotenv(`A=1\nB="never closed\nC=3\nD='also`)
      expect(vars(doc)).toEqual({ A: '1', C: '3' })
      expect(errors(doc).map((e) => e.line)).toEqual([2, 4])
      expect(errors(doc)[0]!.message).toContain('double quote')
    })

    it('text after a closing quote, skipping the whole quoted span', () => {
      const doc = parseDotenv('A="x\ny" junk\nB=2')
      expect(vars(doc)).toEqual({ B: '2' })
      expect(errors(doc)).toEqual([expect.objectContaining({ line: 1, message: expect.stringContaining('after the closing') })])
    })
  })
})

describe('parseJsonEnv', () => {
  it('turns scalars into strings, keeping number literals exactly', () => {
    const doc = parseJsonEnv('{"A":"x","N":12345678901234567890,"F":1.0,"E":-2e5,"T":true,"Z":false}', { flatten: false })
    expect(vars(doc)).toEqual({ A: 'x', N: '12345678901234567890', F: '1.0', E: '-2e5', T: 'true', Z: 'false' })
    expect(doc.issues).toEqual([])
  })

  it('makes null an empty value with a warning', () => {
    const doc = parseJsonEnv('{\n  "A": null\n}', { flatten: false })
    expect(vars(doc)).toEqual({ A: '' })
    expect(warnings(doc)).toEqual([expect.objectContaining({ line: 2 })])
  })

  it('decodes string escapes, including surrogate pairs', () => {
    expect(vars(parseJsonEnv(String.raw`{"A":"a\n\"b\"\u00e9\ud83d\ude00\/"}`, { flatten: false }))).toEqual({ A: 'a\n"b"é😀/' })
  })

  it('reports nested values as errors when flatten is off', () => {
    const doc = parseJsonEnv('{\n"A": "1",\n"DB": {"HOST": "h"},\n"L": [1]\n}', { flatten: false })
    expect(vars(doc)).toEqual({ A: '1' })
    expect(errors(doc).map((e) => e.line)).toEqual([3, 4])
    expect(errors(doc)[0]!.message).toContain('flatten')
  })

  it('flattens with __ and array indexes, keeping order', () => {
    const doc = parseJsonEnv('{"DB":{"HOST":"h","PORT":5432,"OPTS":{"SSL":true}},"HOSTS":["a","b"],"X":1}', { flatten: true })
    expect(doc.entries.map((e) => [e.key, e.value])).toEqual([
      ['DB__HOST', 'h'],
      ['DB__PORT', '5432'],
      ['DB__OPTS__SSL', 'true'],
      ['HOSTS__0', 'a'],
      ['HOSTS__1', 'b'],
      ['X', '1'],
    ])
  })

  it('warns on an empty nested container when flattening', () => {
    const doc = parseJsonEnv('{"A":{},"B":[]}', { flatten: true })
    expect(doc.entries).toEqual([])
    expect(warnings(doc)).toHaveLength(2)
  })

  it('reports flatten collisions and JSON duplicate keys as duplicates', () => {
    const doc = parseJsonEnv('{"A__B":"1",\n"A":{"B":"2"},\n"A__B":"3"}', { flatten: true })
    expect(vars(doc)).toEqual({ A__B: '3' })
    expect(warnings(doc).map((w) => w.line)).toEqual([2, 3])
  })

  it('rejects keys that are not valid env names, by line', () => {
    const doc = parseJsonEnv('{\n"ok":"1",\n"has space":"2",\n"1st":"3"\n}', { flatten: false })
    expect(vars(doc)).toEqual({ ok: '1' })
    expect(errors(doc).map((e) => e.line)).toEqual([3, 4])
  })

  it('rejects a non-object top level', () => {
    for (const src of ['[1,2]', '"x"', '1', 'null']) {
      const doc = parseJsonEnv(src, { flatten: true })
      expect(doc.entries).toEqual([])
      expect(errors(doc)[0]!.message).toContain('top level')
    }
  })

  it('reports syntax errors with a line number', () => {
    const cases: [string, number][] = [
      ['{\n"A": 1,\n}', 3],
      ['{"A": 1', 1],
      ['{\n\n"A": "x\ny"}', 3],
      ['{"A": tru}', 1],
      ['{"A": 1} x', 1],
      ['{"A": "\\q"}', 1],
      ['{"A": "\\u12"}', 1],
      ['{\r\n"A" 1}', 2],
      ['{"A": "never', 1],
      ['', 1],
    ]
    for (const [src, line] of cases) {
      const doc = parseJsonEnv(src, { flatten: false })
      expect(doc.entries, src).toEqual([])
      expect(errors(doc), src).toEqual([expect.objectContaining({ line, message: expect.stringMatching(/^Invalid JSON/) })])
    }
  })

  it('bounds nesting depth instead of overflowing the stack', () => {
    const deep = `{"A":${'['.repeat(100_000)}`
    expect(errors(parseJsonEnv(deep, { flatten: true }))[0]!.message).toContain('levels deep')
  })

  it('agrees with JSON.parse on what it accepts', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const doc = parseJsonEnv(JSON.stringify(obj), { flatten: true })
        expect(doc.issues.some((i) => i.message.startsWith('Invalid JSON'))).toBe(false)
      }),
    )
  })
})

describe('serializers', () => {
  it('JSON keeps entry order and string values', () => {
    expect(toJson(entries({ B: '1', A: 'x"y' }))).toBe('{\n  "B": "1",\n  "A": "x\\"y"\n}')
    expect(toJson([])).toBe('{}')
  })

  it('.env picks the lightest safe quoting', () => {
    expect(quoteDotenvValue('plain-value_1.2:/x=y')).toBe('plain-value_1.2:/x=y')
    expect(quoteDotenvValue('café')).toBe('café')
    expect(quoteDotenvValue('')).toBe('')
    expect(quoteDotenvValue('has space')).toBe('"has space"')
    expect(quoteDotenvValue('a#b')).toBe('"a#b"')
    expect(quoteDotenvValue("it's")).toBe(`"it's"`)
    expect(quoteDotenvValue(' lead')).toBe('" lead"')
    expect(quoteDotenvValue('say "hi"')).toBe(`'say "hi"'`)
    expect(quoteDotenvValue('C:\\path')).toBe(`'C:\\path'`)
    expect(quoteDotenvValue('$HOME')).toBe(`'$HOME'`)
    expect(quoteDotenvValue('l1\nl2')).toBe('"l1\\nl2"')
    expect(quoteDotenvValue(`it's "x"`)).toBe(`"it's \\"x\\""`)
  })

  it('.env output ends with a newline, and is empty for nothing', () => {
    expect(toDotenv(entries({ A: '1' }))).toBe('A=1\n')
    expect(toDotenv([])).toBe('')
  })

  it('shell quotes with POSIX single quotes', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(shellQuote('')).toBe(`''`)
    expect(toShell(entries({ A: 'x y', B: '' })).text).toBe(`export A='x y'\nexport B=''\n`)
  })

  it('shell reports keys that are not shell identifiers, and NUL', () => {
    const r = toShell([
      { key: 'OK', value: '1', line: 1 },
      { key: 'a.b', value: '2', line: 2 },
      { key: 'c-d', value: '3', line: 3 },
      { key: 'NUL', value: 'a\0b', line: 4 },
    ])
    expect(r.text).toBe(`export OK='1'\n`)
    expect(r.issues.map((i) => [i.severity, i.line])).toEqual([
      ['error', 2],
      ['error', 3],
      ['error', 4],
    ])
  })

  it('docker writes raw values and reports what it cannot hold', () => {
    const r = toDockerEnv([
      { key: 'A', value: 'say "hi" # not a comment', line: 1 },
      { key: 'B', value: 'l1\nl2', line: 2 },
      { key: 'C', value: ' padded', line: 3 },
      { key: 'D', value: 'x\ry', line: 4 },
    ])
    expect(r.text).toBe('A=say "hi" # not a comment\nC= padded\n')
    expect(r.issues.map((i) => [i.severity, i.line])).toEqual([
      ['error', 2],
      ['warning', 3],
      ['error', 4],
    ])
  })

  it('serializeEnv dispatches every format', () => {
    const e = entries({ A: '1' })
    expect(serializeEnv(e, 'json').text).toBe('{\n  "A": "1"\n}')
    expect(serializeEnv(e, 'dotenv').text).toBe('A=1\n')
    expect(serializeEnv(e, 'shell').text).toBe(`export A='1'\n`)
    expect(serializeEnv(e, 'docker').text).toBe('A=1\n')
  })
})

describe('parseShellExports', () => {
  it('reads quoting forms and concatenation', () => {
    const doc = parseShellExports(
      [`export A='it'\\''s'`, `B="x \\"y\\" \\$z \\q"`, `C=a\\ b`, `D=a#b # c`, `E='l1`, `l2'; # tail`, `F=`].join('\n'),
    )
    expect(vars(doc)).toEqual({ A: "it's", B: 'x "y" $z \\q', C: 'a b', D: 'a#b', E: 'l1\nl2', F: '' })
    expect(doc.entries.find((e) => e.key === 'F')?.line).toBe(7)
    expect(doc.issues).toEqual([])
  })

  it('reads a CRLF file, keeping a CR that is inside quotes', () => {
    expect(vars(parseShellExports("export A='1'\r\nB=2 # c\r\nC='x\ry'\r\n"))).toEqual({ A: '1', B: '2', C: 'x\ry' })
  })

  it('reports bad lines and unclosed quotes', () => {
    expect(errors(parseShellExports('export a.b=1')).map((e) => e.line)).toEqual([1])
    expect(errors(parseShellExports('A=1 B')).map((e) => e.line)).toEqual([1])
    expect(errors(parseShellExports("A=1\nB='open")).map((e) => e.line)).toEqual([2])
    expect(errors(parseShellExports('A="open')).map((e) => e.line)).toEqual([1])
  })
})

// Values that stress every quoting rule: quotes of all three kinds, `#`, `$`,
// backslashes, CR/LF, tabs, leading/trailing spaces, and astral unicode.
const nasty = fc.oneof(
  fc.string({ unit: fc.constantFrom('a', ' ', '#', '"', "'", '`', '\\', '$', '\n', '\r', '\t', '=', 'é', '😀', 'n') }),
  fc.string({ unit: 'grapheme' }),
  fc.string({ unit: 'binary' }),
)
const envKey = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_.-]{0,11}$/)
const shellKey = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,11}$/)
const envMap = (key: fc.Arbitrary<string>) => fc.uniqueArray(fc.tuple(key, nasty), { selector: ([k]) => k, maxLength: 12 })

describe('round trips', () => {
  it('.env → JSON → .env preserves every key and value, in order', () => {
    fc.assert(
      fc.property(envMap(envKey), (pairs) => {
        // Blank input converts to blank output, not `{}`; covered separately.
        fc.pre(pairs.length > 0)
        const start = pairs.map(([key, value], i) => ({ key, value, line: i + 1 }))
        const dotenv = toDotenv(start)
        const first = parseDotenv(dotenv)
        expect(first.issues.filter((i) => i.severity === 'error')).toEqual([])
        expect(first.entries.map((e) => [e.key, e.value])).toEqual(pairs)

        const json = convertEnv(dotenv, { from: 'auto', to: 'json', flatten: false })
        expect(json.output).toBe(toJson(start))
        const back = convertEnv(json.output, { from: 'auto', to: 'dotenv', flatten: false })
        expect(back.from).toBe('json')
        expect(back.output).toBe(dotenv)
      }),
      { numRuns: 500 },
    )
  })

  it('shell output re-parses to the same values', () => {
    fc.assert(
      fc.property(envMap(shellKey), (pairs) => {
        const clean = pairs.map(([k, v]) => [k, v.replaceAll('\0', '')] as const)
        const r = toShell(clean.map(([key, value], i) => ({ key, value, line: i + 1 })))
        expect(r.issues).toEqual([])
        const doc = parseShellExports(r.text)
        expect(doc.issues).toEqual([])
        expect(doc.entries.map((e) => [e.key, e.value])).toEqual(clean)
      }),
      { numRuns: 500 },
    )
  })

  it('docker output re-reads literally when it emits a value', () => {
    fc.assert(
      fc.property(envMap(envKey), (pairs) => {
        const r = toDockerEnv(pairs.map(([key, value], i) => ({ key, value, line: i + 1 })))
        const kept = pairs.filter(([, v]) => !/[\r\n\0]/.test(v))
        // Docker's own reading: split on lines, cut at the first `=`.
        const read = r.text === '' ? [] : r.text.slice(0, -1).split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
        expect(read).toEqual(kept)
      }),
    )
  })
})

describe('convertEnv', () => {
  it('detects the input format', () => {
    expect(detectEnvFormat('  \n {"A":1}')).toBe('json')
    expect(detectEnvFormat('[1]')).toBe('json')
    expect(detectEnvFormat('\uFEFF{}')).toBe('json')
    expect(detectEnvFormat('A=1')).toBe('dotenv')
    expect(detectEnvFormat('')).toBe('dotenv')
  })

  it('returns nothing for blank input, without errors', () => {
    expect(convertEnv('  \n', { from: 'json', to: 'shell', flatten: false })).toEqual({ from: 'json', entries: [], output: '', issues: [] })
  })

  it('merges parse and serialize issues by line', () => {
    const r = convertEnv('a.b=1\nA=1\nA="x\ny"', { from: 'auto', to: 'shell', flatten: false })
    expect(r.output).toBe(`export A='x\ny'\n`)
    expect(r.issues.map((i) => [i.severity, i.line])).toEqual([
      ['error', 1],
      ['warning', 3],
    ])
  })

  it('JSON input to every output', () => {
    const src = '{"A": "x y", "N": 3}'
    expect(convertEnv(src, { from: 'auto', to: 'dotenv', flatten: false }).output).toBe('A="x y"\nN=3\n')
    expect(convertEnv(src, { from: 'json', to: 'shell', flatten: false }).output).toBe(`export A='x y'\nexport N='3'\n`)
    expect(convertEnv(src, { from: 'json', to: 'docker', flatten: false }).output).toBe('A=x y\nN=3\n')
  })

  it('forcing .env on JSON text reports errors rather than throwing', () => {
    const r = convertEnv('{"A": 1}', { from: 'dotenv', to: 'json', flatten: false })
    expect(r.entries).toEqual([])
    expect(errors(r)).toHaveLength(1)
  })
})

describe('maskEntries', () => {
  it('hides every non-empty value and keeps keys, lines and empties', () => {
    const masked = maskEntries(entries({ A: 'secret', B: '' }))
    expect(masked).toEqual([
      { key: 'A', value: MASK, line: 1 },
      { key: 'B', value: '', line: 2 },
    ])
    expect(toDotenv(masked)).toBe(`A=${MASK}\nB=\n`)
  })
})
