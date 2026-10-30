import { describe, expect, it } from 'vitest'
import { captureGroupNames, checkFlags, compileRegex, parseRegexLiteral } from './compile.ts'

describe('checkFlags', () => {
  it('accepts every valid combination it is given', () => {
    expect(checkFlags('')).toBeNull()
    expect(checkFlags('dgimsuy')).toBeNull()
    expect(checkFlags('gv')).toBeNull()
  })

  it('names the problem', () => {
    expect(checkFlags('gx')).toBe('Unknown flag "x". JavaScript has d, g, i, m, s, u, v, y.')
    expect(checkFlags('gig')).toBe('The flag "g" appears twice.')
    expect(checkFlags('uv')).toMatch(/cannot be combined/)
  })
})

describe('compileRegex', () => {
  it('compiles', () => {
    const r = compileRegex('a(b)', 'gi')
    expect(r.ok && r.regex.flags).toBe('gi')
  })

  it('reports a pattern error without repeating the pattern', () => {
    const r = compileRegex('(abc', 'g')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('pattern')
    expect(r.message).not.toMatch(/Invalid regular expression/)
    expect(r.message).not.toMatch(/\(abc/)
    expect(r.message.length).toBeGreaterThan(0)
  })

  it('reports flag errors before compiling', () => {
    expect(compileRegex('a', 'q')).toMatchObject({ ok: false, kind: 'flags' })
  })

  it('accepts u-mode syntax only with u', () => {
    expect(compileRegex('\\p{L}', 'u').ok).toBe(true)
    expect(compileRegex('\\p{L}', 'v').ok).toBe(true)
  })
})

describe('parseRegexLiteral', () => {
  it('splits a literal', () => {
    expect(parseRegexLiteral('/a\\/b/gi')).toEqual({ pattern: 'a\\/b', flags: 'gi' })
    expect(parseRegexLiteral('  /x/  ')).toEqual({ pattern: 'x', flags: '' })
  })

  it('leaves anything else alone', () => {
    expect(parseRegexLiteral('abc')).toBeNull()
    expect(parseRegexLiteral('/')).toBeNull()
    expect(parseRegexLiteral('//')).toBeNull()
    expect(parseRegexLiteral('/path/to/file.txt')).toBeNull()
    expect(parseRegexLiteral('/a/G')).toBeNull()
  })
})

describe('captureGroupNames', () => {
  const cases: Array<[string, string, Array<string | null>]> = [
    ['abc', '', []],
    ['(a)(b)', '', [null, null]],
    ['(?<year>\\d{4})-(\\d{2})', '', ['year', null]],
    ['(?:a)(?=b)(?!c)(?<=d)(?<!e)(f)', '', [null]],
    ['\\(a\\)', '', []],
    ['[(](a)', '', [null]],
    ['[\\]()](b)', '', [null]],
    ['[a[(]](c)', 'v', [null]],
    ['(?<a>x)|(?<a>y)', '', ['a', 'a']],
    ['((a)(?<n>b))', '', [null, null, 'n']],
    ['(?i:a)(b)', '', [null]],
  ]

  it.each(cases)('%s /%s', (pattern, flags, expected) => {
    expect(captureGroupNames(pattern, flags)).toEqual(expected)
  })

  it('agrees with the engine on the group count', () => {
    for (const [pattern, flags] of cases) {
      let re: RegExp
      try {
        re = new RegExp(`${pattern}|`, flags)
      } catch {
        continue // duplicate names need a newer engine
      }
      expect(captureGroupNames(pattern, flags)).toHaveLength(re.exec('')!.length - 1)
    }
  })
})
