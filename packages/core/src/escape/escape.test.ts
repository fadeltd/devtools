import fc from 'fast-check'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ESCAPE_OPTIONS,
  ESCAPE_MODES,
  convertString,
  escapeString,
  unescapeString,
  type EscapeMode,
  type EscapeOptions,
} from './escape.ts'
import { escapeJs, unescapeJs } from './js.ts'
import { escapeJson, unescapeJson } from './json.ts'
import { escapeRegex } from './regex.ts'
import { escapeShell } from './shell.ts'

// Any UTF-16 code unit, so lone surrogates and controls turn up; 'binary'
// covers astral characters as proper pairs; the tricky alphabet hits the
// escape characters far more often than uniform sampling would.
const units = fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((n) => String.fromCharCode(n)) })
const tricky = fc.string({
  unit: fc.constantFrom('\\', '"', "'", '`', '$', '{', '}', '\n', '\r', '\0', '1', 'u', 'x', '\u2028', '\ud83d', '\ude00', ' ', 'a', '&', ';', '#', '%', '_', '\x1a', '.', '*'),
})
const text = fc.oneof(units, fc.string({ unit: 'binary' }), tricky)

const options: fc.Arbitrary<EscapeOptions> = fc.record({
  wrap: fc.constant(true),
  asciiOnly: fc.boolean(),
  quote: fc.constantFrom('"' as const, "'" as const, '`' as const),
  sqlDialect: fc.constantFrom('standard' as const, 'mysql' as const),
})

describe('round trips', () => {
  for (const { mode } of ESCAPE_MODES) {
    it(`${mode}: unescape(escape(x)) === x`, () => {
      fc.assert(
        fc.property(text, options, (x, opts) => {
          const escaped = escapeString(x, mode, opts)
          if (!escaped.ok) throw new Error('escape never fails')
          const back = unescapeString(escaped.output, mode, opts)
          expect(back).toMatchObject({ ok: true, output: x })
        }),
        { numRuns: 500 },
      )
    })
  }

  it('also round-trips a bare body when its first and last characters are not one quote', () => {
    fc.assert(
      fc.property(text, (x) => {
        const body = escapeJs(x, { quote: '"', wrap: false })
        fc.pre(!(body.length >= 2 && /^['`]/.test(body) && body.at(-1) === body[0]))
        expect(unescapeJs(body)).toMatchObject({ ok: true, output: x })
        expect(unescapeJson(escapeJson(x, { wrap: false }))).toMatchObject({ ok: true, output: x })
      }),
    )
  })
})

describe('JSON', () => {
  it('JSON.parse(escapeJson(x)) returns x', () => {
    fc.assert(
      fc.property(text, fc.boolean(), (x, asciiOnly) => {
        expect(JSON.parse(escapeJson(x, { asciiOnly }))).toBe(x)
      }),
    )
  })

  it('accepts exactly what JSON.parse accepts for a quoted literal, with the same value', () => {
    const jsonish = fc.string({
      unit: fc.constantFrom('\\', '"', 'u', '0', 'a', 'F', 'n', '/', '\n', '\t', ' ', 'x', "'", '{'),
    })
    fc.assert(
      fc.property(jsonish, (body) => {
        const literal = `"${body}"`
        let expected: unknown
        try {
          expected = JSON.parse(literal)
        } catch {
          expect(unescapeJson(literal).ok).toBe(false)
          return
        }
        expect(unescapeJson(literal)).toMatchObject({ ok: true, output: expected })
      }),
      { numRuns: 2000 },
    )
  })
})

// A real engine is the only honest oracle for "is this a valid literal with
// this value". vm runs it in Node, in a fresh context; the app never does.
// Parenthesised, or ASI would read `""\n""` as two statements.
const evaluate = (src: string): unknown => new vm.Script(`'use strict'; (${src})`).runInNewContext()

describe('JavaScript', () => {
  it('evaluates to the original text in a real engine, for every quote', () => {
    fc.assert(
      fc.property(text, options, (x, { quote, asciiOnly }) => {
        expect(evaluate(escapeJs(x, { quote, asciiOnly }))).toBe(x)
      }),
      { numRuns: 500 },
    )
  })

  it('agrees with the engine on what a literal means', () => {
    const jsish = fc.string({
      unit: fc.constantFrom('\\', '"', 'u', '{', '}', '0', '1', '8', 'x', 'a', 'F', 'n', '\n', '\r', '\u2028'),
    })
    fc.assert(
      fc.property(jsish, (body) => {
        const literal = `"${body}"`
        let expected: unknown
        try {
          expected = evaluate(literal)
        } catch {
          expect(unescapeJs(literal).ok).toBe(false)
          return
        }
        expect(unescapeJs(literal)).toMatchObject({ ok: true, output: expected })
      }),
      { numRuns: 2000 },
    )
  })
})

describe('shell', () => {
  it('quotes so that every single quote is a delimiter or the escaped \\\' of the idiom', () => {
    // The whole output must be single-quoted runs (which cannot contain ')
    // joined by \' — nothing else, so nothing in it is ever interpreted.
    const SAFE = /^'[^']*'(?:\\''[^']*')*$/
    fc.assert(
      fc.property(text, (x) => {
        expect(escapeShell(x)).toMatch(SAFE)
      }),
    )
  })
})

describe('regex', () => {
  it('matches exactly the original text, lone surrogates included, with and without the u and v flags', () => {
    fc.assert(
      fc.property(text, fc.constantFrom('', 'u', 'v'), (x, flags) => {
        const re = new RegExp(`^(?:${escapeRegex(x)})$`, flags)
        expect(re.test(x)).toBe(true)
        expect(re.test(`${x}a`)).toBe(false)
      }),
    )
  })

  it('stays a valid regex literal', () => {
    expect(escapeRegex('a/b\nc')).toBe('a\\/b\\nc')
  })
})

describe('dispatch', () => {
  it('passes the options to the right mode', () => {
    const opts: EscapeOptions = { ...DEFAULT_ESCAPE_OPTIONS, quote: "'", wrap: false }
    expect(escapeString("it's", 'js', opts)).toEqual({ ok: true, output: "it\\'s", warnings: [] })
    expect(convertString("'it''s'", 'unescape', 'sql')).toEqual({ ok: true, output: "it's", warnings: [] })
  })

  it('lists every mode once', () => {
    const modes: EscapeMode[] = ESCAPE_MODES.map((m) => m.mode)
    expect(new Set(modes).size).toBe(6)
  })
})
