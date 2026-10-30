import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { analyze, MAX_ISSUES, SNIPPET_MAX_LINE, stripJsonc } from './errors.ts'

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

/** The original character-at-a-time implementation, kept as the oracle. */
function stripJsoncReference(text: string): string {
  let out = ''
  let i = 0
  let inString = false
  while (i < text.length) {
    const ch = text[i]!
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < text.length) {
        const c = text[j]!
        if (/\s/.test(c)) j++
        else if (c === '/' && text[j + 1] === '/') {
          while (j < text.length && text[j] !== '\n') j++
        } else if (c === '/' && text[j + 1] === '*') {
          j += 2
          while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++
          j += 2
        } else break
      }
      if (text[j] === '}' || text[j] === ']') {
        i++
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

describe('stripJsonc — matches the reference implementation', () => {
  // Biased towards the characters the stripper reacts to, so the interesting
  // interleavings actually come up.
  const piece = fc.constantFrom('"', '\\', '/', '*', ',', '}', ']', '{', '\n', ' ', '\t', 'a', '1', '//', '/*', '*/')
  const soup = fc.array(piece, { maxLength: 40 }).map((parts) => parts.join(''))

  it('on comment, string and comma soup', () => {
    fc.assert(
      fc.property(soup, (text) => {
        expect(stripJsonc(text)).toBe(stripJsoncReference(text))
      }),
      { numRuns: 2000 },
    )
  })

  it('on serialised JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = JSON.stringify(value, null, 1)
        expect(stripJsonc(text)).toBe(stripJsoncReference(text))
      }),
    )
  })
})

describe('analyze — hostile input', () => {
  it('caps the issues it reports, and says there were more', () => {
    const prose = 'lorem ipsum dolor sit amet '.repeat(5000)
    const a = analyze(prose, strict)
    expect(a.flavor).toBe('invalid')
    expect(a.issues).toHaveLength(MAX_ISSUES)
    expect(a.moreIssues).toBe(true)
  })

  it('does not claim more issues when it reported them all', () => {
    const a = analyze('{"a": ,}', strict)
    expect(a.issues.length).toBeLessThan(MAX_ISSUES)
    expect(a.moreIssues).toBe(false)
    expect(analyze('{"a":1}', strict).moreIssues).toBe(false)
  })

  it('cuts a long snippet line to a window around the caret', () => {
    const items = Array.from({ length: 5000 }, (_, i) => `{"id":${i}}`).join(',')
    const issue = analyze(`[${items},]`, strict).issues[0]!
    expect(issue.code).toBe('trailing-comma')
    expect(issue.line).toBe(1)
    const shown = issue.snippet.lines[0]!.text
    expect(shown.length).toBeLessThanOrEqual(SNIPPET_MAX_LINE)
    expect(shown.startsWith('…')).toBe(true)
    // The caret still sits under the offending comma.
    expect(shown[issue.snippet.caretColumn - 1]).toBe(',')
  })

  it('windows every context line to the same columns', () => {
    const long = 'x'.repeat(1000)
    const text = `{\n"a": "${long}",\n"b": "${long}" "c"\n}`
    const issue = analyze(text, strict).issues[0]!
    const caretLine = issue.snippet.lines.find((l) => l.number === issue.snippet.caretLine)!
    expect(caretLine.text[issue.snippet.caretColumn - 1]).toBe('"')
    for (const l of issue.snippet.lines) expect(l.text.length).toBeLessThanOrEqual(SNIPPET_MAX_LINE)
  })

  it('leaves short snippet lines whole', () => {
    const issue = analyze('{\n  "a": ,\n}', strict).issues[0]!
    expect(issue.snippet.lines.map((l) => l.text)).toEqual(['{', '  "a": ,', '}'])
  })
})
