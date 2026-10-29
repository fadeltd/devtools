import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { clean, type CleanOptions } from './clean.ts'
import { summary } from './inspect.ts'

describe('clean', () => {
  it('returns the input untouched when there is nothing to do', () => {
    const text = 'plain text\r\nwith CRLF\tand tabs 😀'
    expect(clean(text)).toEqual({
      text,
      changed: false,
      removed: { invisible: 0, bidi: 0, tag: 0 },
      spacesReplaced: 0,
      normalized: false,
    })
  })

  it('removes the zero-width space that broke the parser', () => {
    const r = clean('{"key​": 1}')
    expect(r.text).toBe('{"key": 1}')
    expect(r.changed).toBe(true)
    expect(r.removed.invisible).toBe(1)
  })

  it('removes a leading BOM and soft hyphens', () => {
    expect(clean('﻿co­op').text).toBe('coop')
  })

  it('removes bidi controls from the Trojan Source sample', () => {
    const sample = '/*‮ } ⁦if (isAdmin)⁩ ⁦ begin admins only */'
    const r = clean(sample)
    expect(r.text).toBe('/* } if (isAdmin)  begin admins only */')
    expect(r.removed.bidi).toBe(4)
    expect(summary(r.text).flaggedCount).toBe(0)
  })

  it('removes smuggled tag characters', () => {
    const r = clean('ok\u{e0068}\u{e0069}')
    expect(r.text).toBe('ok')
    expect(r.removed.tag).toBe(2)
  })

  it('replaces exotic spaces with a plain space', () => {
    const r = clean('a b c　d e')
    expect(r.text).toBe('a b c d e')
    expect(r.spacesReplaced).toBe(4)
  })

  it('keeps emoji sequences intact', () => {
    const text = '👨‍👩‍👧 🏳️‍🌈 🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f} ❤️'
    expect(clean(text).text).toBe(text)
  })

  it('leaves controls, variation selectors, private use and lone surrogates alone', () => {
    const text = 'a\u0001︎\ud800�'
    expect(clean(text).text).toBe(text)
  })

  it('honours each option', () => {
    const text = 'a​b‮c\u{e0041}d e'
    expect(clean(text, { invisible: false }).text).toBe('a​bcd e')
    expect(clean(text, { bidi: false }).text).toBe('ab‮cd e')
    expect(clean(text, { tags: false }).text).toBe('abc\u{e0041}d e')
    expect(clean(text, { spaces: false }).text).toBe('abcd e')
  })

  it('normalises after removing, so a removed character cannot block composition', () => {
    const r = clean('e​́', { normalize: 'NFC' })
    expect(r.text).toBe('é')
    expect(r.normalized).toBe(true)
  })

  it('applies NFKC', () => {
    const r = clean('ﬁ①', { normalize: 'NFKC' })
    expect(r.text).toBe('fi1')
    expect(r.changed).toBe(true)
  })

  it('reports normalized: false when normalisation is a no-op', () => {
    expect(clean('abc', { normalize: 'NFC' })).toMatchObject({ normalized: false, changed: false })
  })
})

const unitArb = fc.oneof(
  fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
  fc.constantFrom(
    '​', '‍', '﻿', '­', '‮', '⁦', ' ', ' ', ' ', '　',
    'ㅤ', 'ﾠ', '️', '\u{1f600}', '\u{1f3f4}', '\u{e0067}', '\u{e007f}', '́', 'e',
    '\ud800', '\udc00', '¨', 'ᄀ', 'ᅡ',
  ),
)
const textArb = fc.string({ unit: unitArb, maxLength: 24 })
const optsArb: fc.Arbitrary<CleanOptions> = fc.record({
  invisible: fc.boolean(),
  bidi: fc.boolean(),
  tags: fc.boolean(),
  spaces: fc.boolean(),
  normalize: fc.constantFrom('none', 'NFC', 'NFKC'),
})

describe('clean properties', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(textArb, optsArb, (text, opts) => {
        const once = clean(text, opts).text
        expect(clean(once, opts).text).toBe(once)
      }),
      { numRuns: 2000 },
    )
  })

  it('leaves nothing it was asked to remove', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const { flagCounts } = summary(clean(text).text)
        expect(flagCounts.invisible + flagCounts.bidi + flagCounts.tag + flagCounts.space).toBe(0)
      }),
      { numRuns: 1000 },
    )
  })
})
