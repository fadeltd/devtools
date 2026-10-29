import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  buildIndex,
  inspect,
  inspectAt,
  inspectFlaggedRange,
  inspectRange,
  summary,
} from './inspect.ts'
import { generalCategory, nameOf, UNICODE_FLAGS, type UnicodeFlag } from './tables.ts'

function flagsAt(text: string): { hex: string; flags: UnicodeFlag[] }[] {
  return inspect(text)
    .filter((r) => r.flags.length > 0)
    .map((r) => ({ hex: r.hex, flags: r.flags }))
}

function onlyFlag(cp: number): UnicodeFlag[] {
  const row = inspect(`a${String.fromCodePoint(cp)}b`)[1]!
  return row.flags
}

describe('flag classes', () => {
  it.each([0x200b, 0x200c, 0x200d, 0x2060, 0x2064, 0xfeff, 0x00ad, 0x180e, 0x034f, 0x115f, 0x1160, 0x3164, 0xffa0])(
    'U+%s is invisible',
    (cp) => {
      expect(onlyFlag(cp)).toEqual(['invisible'])
    },
  )

  it.each([0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0x061c])('U+%s is bidi', (cp) => {
    expect(onlyFlag(cp)).toEqual(['bidi'])
  })

  it.each([0x00, 0x07, 0x1b, 0x7f, 0x80, 0x85, 0x9f, 0x2028, 0x2029])('U+%s is control', (cp) => {
    expect(onlyFlag(cp)).toEqual(['control'])
  })

  it('does not flag tab, LF or CR', () => {
    expect(flagsAt('a\tb\nc\r\nd')).toEqual([])
  })

  it.each([0x00a0, 0x1680, 0x2000, 0x2007, 0x200a, 0x202f, 0x205f, 0x3000])('U+%s is space', (cp) => {
    expect(onlyFlag(cp)).toEqual(['space'])
  })

  it('does not flag the ASCII space', () => {
    expect(flagsAt('a b')).toEqual([])
  })

  it.each([0xfe00, 0xfe0f, 0xe0100, 0xe01ef])('U+%s is variation', (cp) => {
    expect(onlyFlag(cp)).toEqual(['variation'])
  })

  it.each([0xe0001, 0xe0041, 0xe007f])('U+%s is tag outside a flag sequence', (cp) => {
    expect(onlyFlag(cp)).toEqual(['tag'])
  })

  it.each([0xe000, 0xf8ff, 0xf0000, 0x10fffd])('U+%s is private-use', (cp) => {
    expect(onlyFlag(cp)).toEqual(['private-use'])
  })

  it('flags U+FFFD as replacement and still draws it', () => {
    const row = inspect('�')[0]!
    expect(row.flags).toEqual(['replacement'])
    expect(row.placeholder).toBe(false)
    expect(row.display).toBe('�')
    expect(row.name).toBe('REPLACEMENT CHARACTER')
  })

  it('leaves ordinary text unflagged', () => {
    expect(flagsAt('Hello, wörld! 你好 Ω ½ €')).toEqual([])
  })

  it('names every flagged character', () => {
    const sample = [
      0x200b, 0x200d, 0xfeff, 0x00ad, 0x200e, 0x202e, 0x2066, 0x061c, 0x01, 0x85, 0x2028, 0x00a0, 0x2009,
      0x3000, 0xfe0f, 0xe0100, 0xe0041, 0xe000, 0xfffd,
    ]
    for (const cp of sample) expect(nameOf(cp), `U+${cp.toString(16)}`).not.toBeNull()
  })
})

describe('row contents', () => {
  it('reports a zero-width space fully', () => {
    const row = inspect('a​b')[1]!
    expect(row).toMatchObject({
      index: 1,
      offset: 1,
      length: 1,
      line: 1,
      column: 2,
      char: '​',
      codePoint: 0x200b,
      hex: 'U+200B',
      utf8: 'E2 80 8B',
      utf16: '200B',
      category: 'Cf',
      categoryName: 'Format',
      flags: ['invisible'],
      name: 'ZERO WIDTH SPACE',
      display: 'ZWSP',
      placeholder: true,
    })
  })

  it('encodes each UTF-8 length correctly', () => {
    const rows = inspect('Aé€😀')
    expect(rows.map((r) => r.utf8)).toEqual(['41', 'C3 A9', 'E2 82 AC', 'F0 9F 98 80'])
    expect(rows.map((r) => r.utf16)).toEqual(['0041', '00E9', '20AC', 'D83D DE00'])
    expect(rows.map((r) => r.hex)).toEqual(['U+0041', 'U+00E9', 'U+20AC', 'U+1F600'])
  })

  it('gives code-point index and UTF-16 offset separately', () => {
    const rows = inspect('😀x')
    expect(rows[1]).toMatchObject({ index: 1, offset: 2, column: 3, char: 'x' })
  })

  it('shows no name for ordinary characters', () => {
    expect(inspect('a')[0]!.name).toBeNull()
  })

  it('boxes ASCII whitespace and controls instead of drawing them', () => {
    expect(inspect(' \t').map((r) => [r.display, r.placeholder])).toEqual([
      ['SP', true],
      ['TAB', true],
    ])
  })

  it('puts a combining mark on a dotted circle', () => {
    const row = inspect('é')[1]!
    expect(row.category).toBe('Mn')
    expect(row.display).toBe('◌́')
    expect(row.placeholder).toBe(false)
  })
})

describe('general category', () => {
  it.each([
    ['A', 'Lu'],
    ['a', 'Ll'],
    ['ǅ', 'Lt'],
    ['ʰ', 'Lm'],
    ['中', 'Lo'],
    ['́', 'Mn'],
    ['ः', 'Mc'],
    ['⃝', 'Me'],
    ['7', 'Nd'],
    ['Ⅻ', 'Nl'],
    ['½', 'No'],
    ['_', 'Pc'],
    ['-', 'Pd'],
    ['(', 'Ps'],
    [')', 'Pe'],
    ['«', 'Pi'],
    ['»', 'Pf'],
    ['!', 'Po'],
    ['+', 'Sm'],
    ['$', 'Sc'],
    ['^', 'Sk'],
    ['©', 'So'],
    [' ', 'Zs'],
    [' ', 'Zl'],
    [' ', 'Zp'],
    ['\u0000', 'Cc'],
    ['​', 'Cf'],
    ['\ud800', 'Cs'],
    ['', 'Co'],
    ['͸', 'Cn'],
  ])('%j is %s', (char, gc) => {
    expect(generalCategory(char)).toBe(gc)
  })
})

describe('emoji and graphemes', () => {
  const family = '👨‍👩‍👧‍👦'

  it('reads a ZWJ family as many code points but one grapheme', () => {
    const s = summary(family)
    expect(s.codePoints).toBe(7)
    expect(s.utf16Units).toBe(11)
    expect(s.graphemes).toBe(1)
    expect(s.utf8Bytes).toBe(25)
  })

  it('does not flag the joiners inside an emoji sequence', () => {
    expect(flagsAt(family)).toEqual([])
    const zwj = inspect(family)[1]!
    expect(zwj.name).toBe('ZERO WIDTH JOINER')
    expect(zwj.placeholder).toBe(true)
  })

  it('does not flag a joiner after a presentation selector or skin tone', () => {
    // 🏳️‍🌈 and 👩🏽‍💻
    expect(flagsAt('\u{1f3f3}️‍\u{1f308}').map((r) => r.hex)).toEqual(['U+FE0F'])
    expect(flagsAt('\u{1f469}\u{1f3fd}‍\u{1f4bb}')).toEqual([])
  })

  it('flags a joiner that is not between emoji', () => {
    expect(flagsAt('a‍b')).toEqual([{ hex: 'U+200D', flags: ['invisible'] }])
    expect(flagsAt('\u{1f600}‍')).toEqual([{ hex: 'U+200D', flags: ['invisible'] }])
    expect(flagsAt('‍\u{1f600}')).toEqual([{ hex: 'U+200D', flags: ['invisible'] }])
  })

  it('reads a flag emoji as two regional indicators and one grapheme', () => {
    const s = summary('🇯🇵')
    expect(s.codePoints).toBe(2)
    expect(s.graphemes).toBe(1)
    expect(s.flaggedCount).toBe(0)
    expect(inspect('🇯🇵').map((r) => r.hex)).toEqual(['U+1F1EF', 'U+1F1F5'])
  })

  it('does not flag the tags of a subdivision flag', () => {
    const scotland = '\u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}'
    expect(summary(scotland)).toMatchObject({ codePoints: 7, graphemes: 1, flaggedCount: 0 })
    expect(inspect(scotland)[1]!.name).toBe('TAG LATIN SMALL LETTER G')
  })

  it('flags tags that are not a well-formed flag sequence', () => {
    // Hidden "hi" appended to text: the ASCII-smuggling trick.
    expect(summary('ok\u{e0068}\u{e0069}').flagCounts.tag).toBe(2)
    // 🏴 with tags but no CANCEL TAG.
    expect(summary('\u{1f3f4}\u{e0067}\u{e0062}').flagCounts.tag).toBe(2)
    // Tags after a complete sequence are outside it.
    expect(summary('\u{1f3f4}\u{e0067}\u{e007f}\u{e0068}').flagCounts.tag).toBe(1)
  })

  it('treats a combining accent and the precomposed letter differently', () => {
    const combining = summary('é')
    const precomposed = summary('é')
    expect(combining).toMatchObject({ codePoints: 2, graphemes: 1, utf8Bytes: 3 })
    expect(precomposed).toMatchObject({ codePoints: 1, graphemes: 1, utf8Bytes: 2 })
    expect(inspect('é').map((r) => r.hex)).toEqual(['U+0065', 'U+0301'])
  })
})

describe('lone surrogates', () => {
  it('flags a lone high and a lone low surrogate', () => {
    const rows = inspect('a\ud800b\udc00')
    expect(rows.map((r) => r.hex)).toEqual(['U+0061', 'U+D800', 'U+0062', 'U+DC00'])
    expect(rows[1]).toMatchObject({
      length: 1,
      flags: ['lone-surrogate'],
      category: 'Cs',
      utf8: null,
      utf16: 'D800',
      name: 'LONE HIGH SURROGATE',
      placeholder: true,
    })
    expect(rows[3]!.name).toBe('LONE LOW SURROGATE')
  })

  it('flags reversed surrogates as two lone ones', () => {
    expect(summary('\udc00\ud800').flagCounts['lone-surrogate']).toBe(2)
  })

  it('flags a high surrogate at the very end', () => {
    expect(summary('x\ud83d').flagCounts['lone-surrogate']).toBe(1)
  })

  it('counts UTF-8 bytes the way TextEncoder writes them', () => {
    const text = 'a\ud800😀\udc00é'
    expect(summary(text).utf8Bytes).toBe(new TextEncoder().encode(text).length)
  })
})

describe('lines and columns', () => {
  it('handles CRLF', () => {
    const rows = inspect('ab\r\ncd')
    expect(rows.map((r) => `${r.line}:${r.column}`)).toEqual(['1:1', '1:2', '1:3', '1:4', '2:1', '2:2'])
  })

  it('counts lines without a phantom trailing one', () => {
    expect(summary('').lines).toBe(0)
    expect(summary('a').lines).toBe(1)
    expect(summary('a\nb\n').lines).toBe(2)
    expect(summary('a\r\nb\r\n').lines).toBe(2)
    expect(summary('a\n\n').lines).toBe(2)
  })

  it('counts columns in UTF-16 units after an astral character', () => {
    expect(inspect('😀​')[1]).toMatchObject({ line: 1, column: 3 })
  })
})

describe('Trojan Source', () => {
  // CVE-2021-42574's "commenting-out" sample: reads as a comment, runs as code.
  const sample =
    '/*‮ } ⁦if (isAdmin)⁩ ⁦ begin admins only */\nconsole.log("admin")\n/* end admins only ‮ { ⁦*/'

  it('finds every bidi control with its position', () => {
    const s = summary(sample)
    expect(s.flagCounts.bidi).toBe(6)
    expect(s.flaggedCount).toBe(6)
    expect(s.positions[0]).toMatchObject({
      line: 1,
      column: 3,
      hex: 'U+202E',
      flags: ['bidi'],
      name: 'RIGHT-TO-LEFT OVERRIDE',
    })
    expect(s.positions.map((p) => p.line)).toEqual([1, 1, 1, 1, 3, 3])
  })
})

describe('summary', () => {
  it('reports zeroes for empty input', () => {
    const s = summary('')
    expect(s).toMatchObject({
      utf16Units: 0,
      codePoints: 0,
      graphemes: 0,
      utf8Bytes: 0,
      lines: 0,
      flaggedCount: 0,
      positions: [],
      positionsTruncated: false,
    })
    for (const flag of UNICODE_FLAGS) expect(s.flagCounts[flag]).toBe(0)
  })

  it('caps the positions list but keeps the counts complete', () => {
    const s = summary(' '.repeat(50), { maxPositions: 10 })
    expect(s.positions).toHaveLength(10)
    expect(s.positionsTruncated).toBe(true)
    expect(s.flagCounts.space).toBe(50)
    expect(s.flaggedCount).toBe(50)
  })

  it('accepts a prebuilt index', () => {
    const index = buildIndex('a​')
    expect(summary(index).flaggedCount).toBe(1)
  })
})

describe('ranges over a big input', () => {
  const big = `${'abc​\n'.repeat(200_000)}😀`

  it('indexes a megabyte without materialising rows', () => {
    const index = buildIndex(big)
    expect(index.codePoints).toBe(1_000_001)
    expect(index.flagged.length).toBe(200_000)
  })

  it('returns only the rows asked for', () => {
    const index = buildIndex(big)
    const rows = inspectRange(index, 999_999, 10)
    expect(rows.map((r) => r.hex)).toEqual(['U+000A', 'U+1F600'])
    expect(rows[1]).toMatchObject({ line: 200_001, column: 1 })
    expect(inspectFlaggedRange(index, 199_999, 5)).toHaveLength(1)
    expect(inspectFlaggedRange(index, 0, 1)[0]).toMatchObject({ index: 3, hex: 'U+200B' })
  })

  it('clamps bad ranges instead of throwing', () => {
    const index = buildIndex('ab')
    expect(inspectRange(index, -5, 3).map((r) => r.char)).toEqual(['a', 'b'])
    expect(inspectRange(index, 5, 3)).toEqual([])
    expect(inspectRange(index, 0, -1)).toEqual([])
    expect(inspectAt(index, 2)).toBeNull()
    expect(inspectAt(index, 0.5)).toBeNull()
  })
})

// Plain code points plus the characters whose meaning depends on their neighbours.
const textArb = fc.string({
  unit: fc.oneof(
    fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
    fc.constantFrom('\ud800', '\udc00', '\u200d', '\ufe0f', '😀', '\u{1f3f4}', '\u{e0067}', '\u{e007f}', '\u00a0', '\r', '\n'),
  ),
})

describe('properties', () => {
  it('rows reassemble the input exactly, lone surrogates included', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const rows = inspect(text)
        expect(rows.map((r) => r.char).join('')).toBe(text)
        expect(rows.length).toBe([...text].length)
        for (const r of rows) expect(text.slice(r.offset, r.offset + r.length)).toBe(r.char)
      }),
    )
  })

  it('agrees with TextEncoder on byte count', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        expect(buildIndex(text).utf8Bytes).toBe(new TextEncoder().encode(text).length)
      }),
    )
  })
})
