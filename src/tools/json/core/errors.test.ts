import { describe, expect, it } from 'vitest'
import { analyze, stripJsonc } from './errors'

const strict = { lenient: false }
const lenient = { lenient: true }

describe('analyze — valid input', () => {
  it('takes the fast path and reports no issues', () => {
    const a = analyze('{"a":1}', strict)
    expect(a.flavor).toBe('json')
    expect(a.issues).toEqual([])
    expect(a.value).toEqual({ a: 1 })
  })

  it('reports empty input distinctly from invalid input', () => {
    expect(analyze('', strict).flavor).toBe('empty')
    expect(analyze('   \n ', strict).flavor).toBe('empty')
  })

  it('accepts a bare scalar, which is valid JSON', () => {
    expect(analyze('42', strict).value).toBe(42)
    expect(analyze('"hi"', strict).value).toBe('hi')
    expect(analyze('null', strict).value).toBeNull()
  })
})

describe('analyze — error positions', () => {
  it('points the caret at the trailing comma, not the closing brace', () => {
    const text = '{\n  "retries": 3,\n  "timeout": 5000,\n}'
    const a = analyze(text, strict)
    expect(a.flavor).toBe('invalid')

    // The parser gives up on line 4 (the `}`), but the actionable character is
    // the comma at the end of line 3.
    expect(a.issues).toHaveLength(1)
    expect(a.issues[0]?.code).toBe('trailing-comma')
    expect(a.issues[0]?.line).toBe(3)
    expect(a.issues[0]?.message).toBe('Trailing comma before }')
    expect(text[a.issues[0]!.offset]).toBe(',')
  })

  it('names the closing bracket for a trailing comma in an array', () => {
    const a = analyze('[\n  1,\n  2,\n]', strict)
    expect(a.issues[0]?.message).toBe('Trailing comma before ]')
  })

  it('reports one issue per mistake, not one per parser code', () => {
    // A trailing comma makes jsonc-parser emit both PropertyNameExpected and
    // ValueExpected at the same spot; that is one problem, not two.
    const a = analyze('{\n  "a": 1,\n}', strict)
    expect(a.issues).toHaveLength(1)
  })

  it('locates an unquoted key', () => {
    const a = analyze('{\n  host: "x"\n}', strict)
    expect(a.issues[0]?.line).toBe(2)
    // jsonc-parser classifies a bare identifier as InvalidSymbol rather than
    // PropertyNameExpected, so the hint is what has to mention quoting.
    expect(a.issues[0]?.code).toBe('invalid-symbol')
    expect(a.issues[0]?.hint).toContain('unquoted key')
  })

  it('reports every distinct error, not just the first', () => {
    // jsonc-parser recovers and keeps going, which is the whole reason we use
    // it rather than the engine's own message.
    const a = analyze('{\n  a: 1,\n  b: 2,\n  c: 3\n}', strict)
    expect(a.issues.length).toBeGreaterThan(1)
    // ...but each reported issue sits at its own position.
    expect(new Set(a.issues.map((i) => i.offset)).size).toBe(a.issues.length)
  })

  it('includes a context snippet with a caret column', () => {
    const a = analyze('{\n  "a": ,\n}', strict)
    const issue = a.issues[0]!
    expect(issue.snippet.lines.length).toBeGreaterThan(1)
    expect(issue.snippet.caretLine).toBe(issue.line)
    expect(issue.snippet.caretColumn).toBeGreaterThan(0)
  })

  it('places the caret using visual columns in tab-indented JSON', () => {
    const text = '{\n\t\t"a": ,\n}'
    const issue = analyze(text, strict).issues[0]!
    // Two tabs at width 2 occupy 4 visual columns, so the caret must be past 4
    // even though the character column is much smaller.
    expect(issue.snippet.caretColumn).toBeGreaterThan(4)
  })

  it('reports an unterminated string', () => {
    const a = analyze('{"a": "oops}', strict)
    expect(a.issues.some((i) => i.code === 'unterminated-string')).toBe(true)
  })

  it('reports an invalid escape', () => {
    const a = analyze('{"a": "b\\qc"}', strict)
    expect(a.issues.some((i) => i.code === 'invalid-escape')).toBe(true)
  })

  it('gives every issue a human message', () => {
    for (const bad of ['{', '[', '{"a"}', '{"a":}', '{,}', '[1 2]']) {
      for (const issue of analyze(bad, strict).issues) {
        expect(issue.message.length).toBeGreaterThan(0)
        expect(issue.message).not.toMatch(/^\d+$/)
      }
    }
  })
})

describe('analyze — lenient mode', () => {
  it('rejects comments in strict mode but accepts them leniently', () => {
    const text = '{\n  // a comment\n  "a": 1\n}'
    expect(analyze(text, strict).issues.length).toBeGreaterThan(0)
    const l = analyze(text, lenient)
    expect(l.value).toEqual({ a: 1 })
    expect(l.flavor).toBe('jsonc')
  })

  it('recovers a value despite a trailing comma', () => {
    const l = analyze('{"a": 1,}', lenient)
    expect(l.value).toEqual({ a: 1 })
  })
})

describe('analyze — NDJSON detection', () => {
  it('recognises one JSON value per line', () => {
    const a = analyze('{"a":1}\n{"a":2}\n{"a":3}', strict)
    expect(a.flavor).toBe('ndjson')
    expect(a.ndjson).toEqual({ records: 3 })
  })

  it('does not claim NDJSON for genuinely broken JSON', () => {
    const a = analyze('{"a":1,\n"b":}', strict)
    expect(a.ndjson).toBeNull()
    expect(a.flavor).toBe('invalid')
  })

  it('does not claim NDJSON for a single line', () => {
    expect(analyze('{"a":', strict).ndjson).toBeNull()
  })
})

describe('stripJsonc', () => {
  it('removes line and block comments', () => {
    expect(stripJsonc('{"a":1} // trailing')).toBe('{"a":1} ')
    expect(stripJsonc('{/* mid */"a":1}')).toBe('{"a":1}')
  })

  it('removes trailing commas before } and ]', () => {
    expect(stripJsonc('{"a":1,}')).toBe('{"a":1}')
    expect(stripJsonc('[1,2,]')).toBe('[1,2]')
  })

  it('removes a trailing comma even with a comment in between', () => {
    expect(JSON.parse(stripJsonc('[1,2, // last\n]'))).toEqual([1, 2])
  })

  it('does not touch // or /* inside a string value', () => {
    const text = '{"url":"https://example.com/a","glob":"/*.ts"}'
    expect(JSON.parse(stripJsonc(text))).toEqual({
      url: 'https://example.com/a',
      glob: '/*.ts',
    })
  })

  it('does not touch a comma inside a string', () => {
    expect(JSON.parse(stripJsonc('{"a":"x,"}'))).toEqual({ a: 'x,' })
  })

  it('handles an escaped quote before a comment-like sequence', () => {
    expect(JSON.parse(stripJsonc('{"a":"quote\\" // not a comment"}'))).toEqual({
      a: 'quote" // not a comment',
    })
  })

  it('leaves valid strict JSON byte-identical', () => {
    const text = '{"a":[1,2,{"b":"c"}],"d":null}'
    expect(stripJsonc(text)).toBe(text)
  })
})
