import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseLines, serializeLines } from './lines'

describe('parseLines — the cases every free list tool gets wrong', () => {
  it('does not invent a phantom trailing line', () => {
    const doc = parseLines('a\nb\n')
    expect(doc.lines).toEqual(['a', 'b'])
    expect(doc.trailingNewline).toBe(true)
  })

  it('distinguishes a trailing newline from its absence', () => {
    expect(parseLines('a').trailingNewline).toBe(false)
    expect(parseLines('a\n').trailingNewline).toBe(true)
    expect(parseLines('a').lines).toEqual(['a'])
    expect(parseLines('a\n').lines).toEqual(['a'])
  })

  it('treats empty input as zero lines, not one empty line', () => {
    expect(parseLines('').lines).toEqual([])
    expect(parseLines('').trailingNewline).toBe(false)
  })

  it('treats a lone newline as one empty line', () => {
    const doc = parseLines('\n')
    expect(doc.lines).toEqual([''])
    expect(doc.trailingNewline).toBe(true)
  })

  it('keeps interior blank lines, which are data', () => {
    expect(parseLines('a\n\nb').lines).toEqual(['a', '', 'b'])
  })

  it('never leaves \\r glued to a line end', () => {
    // "a\r" !== "a" would silently break both dedupe and sort.
    const doc = parseLines('a\r\nb\r\n')
    expect(doc.lines).toEqual(['a', 'b'])
    expect(doc.eol).toBe('\r\n')
  })

  it('handles lone CR (classic Mac, still found in old exports)', () => {
    const doc = parseLines('a\rb')
    expect(doc.lines).toEqual(['a', 'b'])
    expect(doc.eol).toBe('\r')
  })

  it('flags mixed line endings rather than silently picking one', () => {
    expect(parseLines('a\r\nb\nc').eol).toBe('mixed')
  })

  it('strips a BOM into a flag so line 1 does not sort bizarrely', () => {
    const doc = parseLines('﻿a\nb')
    expect(doc.bom).toBe(true)
    expect(doc.lines).toEqual(['a', 'b'])
  })

  it('does not report a BOM when there is none', () => {
    expect(parseLines('a').bom).toBe(false)
  })
})

describe('round-trip', () => {
  it('is exact for the hand-picked edge cases', () => {
    for (const t of [
      '',
      'a',
      'a\n',
      '\n',
      '\n\n',
      'a\nb',
      'a\nb\n',
      'a\r\nb\r\n',
      'a\rb',
      '﻿a\nb\n',
      '  spaced  \n\ttabbed\t\n',
    ]) {
      expect(serializeLines(parseLines(t))).toBe(t)
    }
  })

  it('is exact for any input with a uniform line ending', () => {
    const lineArb = fc.stringMatching(/^[^\r\n]*$/)
    fc.assert(
      fc.property(
        fc.array(lineArb),
        fc.constantFrom('\n', '\r\n', '\r'),
        fc.boolean(),
        fc.boolean(),
        (lines, eol, trailing, bom) => {
          const text =
            (bom ? '﻿' : '') + lines.join(eol) + (lines.length > 0 && trailing ? eol : '')
          expect(serializeLines(parseLines(text))).toBe(text)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('normalizes mixed line endings to LF, as documented', () => {
    expect(serializeLines(parseLines('a\r\nb\nc'))).toBe('a\nb\nc')
  })
})
