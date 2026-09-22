import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseLines, serializeLines } from './lines'
import { applyOp, findNormalizationCollisions, runPipeline } from './pipeline'
import type { Op } from './types'

const doc = (text: string) => parseLines(text)
const run = (text: string, op: Op) => applyOp(doc(text), op).lines

const SORT: Omit<Extract<Op, { kind: 'sort' }>, 'mode'> = {
  kind: 'sort',
  order: 'asc',
  caseSensitive: true,
  blanks: 'keep',
}

describe('sort', () => {
  it('sorts by codepoint', () => {
    expect(run('c\na\nb', { ...SORT, mode: 'codepoint' })).toEqual(['a', 'b', 'c'])
  })

  it('sorts descending', () => {
    expect(run('a\nb\nc', { ...SORT, mode: 'codepoint', order: 'desc' })).toEqual(['c', 'b', 'a'])
  })

  it('is case-insensitive when asked', () => {
    // Codepoint order would put all uppercase first.
    expect(run('b\nA\na\nB', { ...SORT, mode: 'codepoint', caseSensitive: false })).toEqual([
      'A',
      'a',
      'b',
      'B',
    ])
  })

  it('natural-sorts numbers inside strings', () => {
    expect(run('item10\nitem9\nitem1', { ...SORT, mode: 'natural' })).toEqual([
      'item1',
      'item9',
      'item10',
    ])
  })

  it('sorts version strings correctly under natural sort', () => {
    // Intl numeric collation compares digit runs per segment, so 1.10 > 1.9.
    // This is why there is no separate "version" sort mode.
    expect(run('1.9.0\n1.10.2\n1.2.0', { ...SORT, mode: 'natural' })).toEqual([
      '1.2.0',
      '1.9.0',
      '1.10.2',
    ])
  })

  it('compares long digit runs exactly, beyond float precision', () => {
    // A Number()-based comparator would collapse these to the same value.
    expect(
      run('1.99999999999999999998\n1.99999999999999999999', { ...SORT, mode: 'natural' }),
    ).toEqual(['1.99999999999999999998', '1.99999999999999999999'])
  })

  it('sorts by length', () => {
    expect(run('xxx\nx\nxx', { ...SORT, mode: 'length' })).toEqual(['x', 'xx', 'xxx'])
  })

  it('is stable for equal keys', () => {
    const out = run('b1\nB2\nb3', { ...SORT, mode: 'codepoint', caseSensitive: false })
    expect(out).toEqual(['b1', 'B2', 'b3'])
  })

  describe('blank lines are data, and their placement is explicit', () => {
    const input = 'b\n\na\n\nc'
    it('keeps them in place by policy "keep"', () => {
      expect(run(input, { ...SORT, mode: 'codepoint', blanks: 'keep' })).toEqual([
        '',
        '',
        'a',
        'b',
        'c',
      ])
    })
    it('hoists them with "first"', () => {
      expect(run(input, { ...SORT, mode: 'codepoint', blanks: 'first' })).toEqual([
        '',
        '',
        'a',
        'b',
        'c',
      ])
    })
    it('sinks them with "last"', () => {
      expect(run(input, { ...SORT, mode: 'codepoint', blanks: 'last' })).toEqual([
        'a',
        'b',
        'c',
        '',
        '',
      ])
    })
    it('drops them only when explicitly told to', () => {
      expect(run(input, { ...SORT, mode: 'codepoint', blanks: 'drop' })).toEqual(['a', 'b', 'c'])
    })
  })
})

describe('dedupe', () => {
  const base = {
    kind: 'dedupe' as const,
    caseSensitive: true,
    trimKey: false,
    keep: 'first' as const,
    output: 'unique' as const,
  }

  it('keeps the first occurrence in original order', () => {
    expect(run('a\nb\na\nc', base)).toEqual(['a', 'b', 'c'])
  })

  it('can keep the last occurrence instead', () => {
    // Apple/apple are one group when folding case; keep: 'last' picks 'apple'.
    expect(run('Apple\nb\napple', { ...base, keep: 'last', caseSensitive: false })).toEqual([
      'apple',
      'b',
    ])
  })

  it('folds case when asked', () => {
    expect(run('Apple\napple\nBee', { ...base, caseSensitive: false })).toEqual(['Apple', 'Bee'])
  })

  it('treats NFC and NFD forms of the same text as one key', () => {
    const nfc = 'café'
    const nfd = 'café'
    expect(run(`${nfc}\n${nfd}`, base)).toEqual([nfc])
  })

  it('shows only duplicates', () => {
    expect(run('a\nb\na\nc\nb', { ...base, output: 'duplicates-only' })).toEqual(['a', 'b'])
  })

  it('shows only lines that appear exactly once', () => {
    expect(run('a\nb\na\nc', { ...base, output: 'unique-only' })).toEqual(['b', 'c'])
  })

  it('emits counts', () => {
    expect(run('a\nb\na', { ...base, output: 'with-counts' })).toEqual(['2\ta', '1\tb'])
  })

  it('can ignore surrounding whitespace in the key', () => {
    expect(run('a\n  a  ', { ...base, trimKey: true })).toEqual(['a'])
  })
})

describe('shuffle', () => {
  it('is a permutation of the input', () => {
    const input = Array.from({ length: 500 }, (_, i) => `line ${i}`)
    const out = applyOp(parseLines(input.join('\n')), { kind: 'shuffle', source: 'crypto' }).lines
    expect(out.toSorted()).toEqual(input.toSorted())
  })

  it('does not throw on 100k lines', () => {
    // crypto.getRandomValues throws QuotaExceededError above 65,536 bytes per
    // call, so an unchunked implementation crashes exactly here.
    const input = Array.from({ length: 100_000 }, (_, i) => String(i)).join('\n')
    expect(() => applyOp(parseLines(input), { kind: 'shuffle', source: 'crypto' })).not.toThrow()
  })

  it('is reproducible with a seed', () => {
    const input = 'a\nb\nc\nd\ne\nf\ng\nh'
    const a = run(input, { kind: 'shuffle', source: 'seeded', seed: 42 })
    const b = run(input, { kind: 'shuffle', source: 'seeded', seed: 42 })
    const c = run(input, { kind: 'shuffle', source: 'seeded', seed: 43 })
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('does not mutate the input doc', () => {
    const d = parseLines('a\nb\nc')
    const before = [...d.lines]
    applyOp(d, { kind: 'shuffle', source: 'crypto' })
    expect(d.lines).toEqual(before)
  })
})

describe('other operations', () => {
  it('reverses', () => {
    expect(run('a\nb\nc', { kind: 'reverse' })).toEqual(['c', 'b', 'a'])
  })

  it('adds a prefix and suffix, optionally skipping blanks', () => {
    expect(
      run('a\n\nb', { kind: 'affix', prefix: 'sk_live_', suffix: '!', skipBlank: true }),
    ).toEqual(['sk_live_a!', '', 'sk_live_b!'])
  })

  it('numbers lines with padding', () => {
    expect(
      run('a\nb', {
        kind: 'number',
        start: 1,
        step: 1,
        pad: 3,
        padChar: '0',
        separator: '. ',
        position: 'prefix',
        skipBlank: false,
      }),
    ).toEqual(['001. a', '002. b'])
  })

  it('trims', () => {
    expect(
      run('  a  \n\tb\t', { kind: 'trim', leading: true, trailing: true, collapseInternal: false }),
    ).toEqual(['a', 'b'])
  })

  it('collapses internal whitespace', () => {
    expect(
      run('a    b', { kind: 'trim', leading: false, trailing: false, collapseInternal: true }),
    ).toEqual(['a b'])
  })

  it('converts case', () => {
    expect(run('hello world', { kind: 'case', target: 'kebab' })).toEqual(['hello-world'])
    expect(run('hello world', { kind: 'case', target: 'camel' })).toEqual(['helloWorld'])
    expect(run('hello world', { kind: 'case', target: 'constant' })).toEqual(['HELLO_WORLD'])
  })

  it('title-cases with stop words, but always capitalises first and last', () => {
    expect(run('the lord of the rings', { kind: 'case', target: 'title' })).toEqual([
      'The Lord of the Rings',
    ])
  })

  it('filters by regex', () => {
    expect(
      run('apple\nbanana\navocado', {
        kind: 'filter',
        action: 'keep',
        test: { t: 'regex', source: '^a', flags: '' },
      }),
    ).toEqual(['apple', 'avocado'])
  })

  it('removes blank lines', () => {
    expect(run('a\n\nb\n   \nc', { kind: 'filter', action: 'remove', test: { t: 'blank' } })).toEqual(
      ['a', 'b', 'c'],
    )
  })

  it('joins', () => {
    expect(run('a\nb\nc', { kind: 'join', separator: ', ' })).toEqual(['a, b, c'])
  })

  it('joins in chunks', () => {
    expect(run('a\nb\nc\nd\ne', { kind: 'join', separator: ',', chunkSize: 2 })).toEqual([
      'a,b',
      'c,d',
      'e',
    ])
  })

  it('splits', () => {
    expect(run('a,b\nc,d', { kind: 'split', by: { t: 'literal', s: ',' } })).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('slices', () => {
    expect(run('a\nb\nc\nd', { kind: 'slice', from: 1, to: 3 })).toEqual(['b', 'c'])
  })
})

describe('set operations', () => {
  const base = { kind: 'setop' as const, caseSensitive: true, bag: false }

  it('unions with first-appearance order', () => {
    expect(run('a\nb', { ...base, op: 'union', other: 'b\nc' })).toEqual(['a', 'b', 'c'])
  })

  it('intersects', () => {
    expect(run('a\nb\nc', { ...base, op: 'intersection', other: 'b\nc\nd' })).toEqual(['b', 'c'])
  })

  it('subtracts', () => {
    expect(run('a\nb\nc', { ...base, op: 'difference', other: 'b' })).toEqual(['a', 'c'])
  })

  it('gives the lines that are in exactly one list', () => {
    expect(run('a\nb', { ...base, op: 'symmetric-difference', other: 'b\nc' })).toEqual(['a', 'c'])
  })

  it('dedupes both sides under set semantics', () => {
    expect(run('a\na\nb', { ...base, op: 'union', other: 'b\nb' })).toEqual(['a', 'b'])
  })

  it('preserves multiplicity under bag semantics', () => {
    expect(run('a\na\nb', { ...base, bag: true, op: 'difference', other: 'a' })).toEqual(['a', 'b'])
  })
})

describe('runPipeline', () => {
  it('chains operations and reports per-step counts', () => {
    const result = runPipeline(doc('b\na\nb\n\nc'), [
      { kind: 'filter', action: 'remove', test: { t: 'blank' } },
      {
        kind: 'dedupe',
        caseSensitive: true,
        trimKey: false,
        keep: 'first',
        output: 'unique',
      },
      { ...SORT, mode: 'codepoint' },
    ])

    expect(result.doc.lines).toEqual(['a', 'b', 'c'])
    expect(result.steps.map((s) => [s.inLines, s.outLines])).toEqual([
      [5, 4],
      [4, 3],
      [3, 3],
    ])
  })

  it('records a bad regex as a step error and keeps going', () => {
    const result = runPipeline(doc('a\nb'), [
      { kind: 'filter', action: 'keep', test: { t: 'regex', source: '([', flags: '' } },
      { kind: 'reverse' },
    ])
    expect(result.steps[0]?.error).toBeTruthy()
    // The failed step is a no-op, so the rest of the chain still runs.
    expect(result.doc.lines).toEqual(['b', 'a'])
  })

  it('preserves the trailing newline through a chain', () => {
    const result = runPipeline(doc('b\na\n'), [{ ...SORT, mode: 'codepoint' }])
    expect(serializeLines(result.doc)).toBe('a\nb\n')
  })
})

describe('normalization collisions', () => {
  it('reports lines that differ only by Unicode form', () => {
    expect(findNormalizationCollisions(['café', 'café', 'other'])).toBe(2)
  })

  it('reports none when forms are consistent', () => {
    expect(findNormalizationCollisions(['a', 'b'])).toBe(0)
  })
})

describe('properties', () => {
  const lineArb = fc.stringMatching(/^[^\r\n]*$/)

  it('sort is idempotent', () => {
    fc.assert(
      fc.property(fc.array(lineArb), (lines) => {
        const op: Op = { ...SORT, mode: 'codepoint' }
        const once = applyOp(parseLines(lines.join('\n')), op)
        const twice = applyOp(once, op)
        expect(twice.lines).toEqual(once.lines)
      }),
      { numRuns: 200 },
    )
  })

  it('reverse is its own inverse', () => {
    fc.assert(
      fc.property(fc.array(lineArb), (lines) => {
        const d = parseLines(lines.join('\n'))
        expect(applyOp(applyOp(d, { kind: 'reverse' }), { kind: 'reverse' }).lines).toEqual(d.lines)
      }),
      { numRuns: 200 },
    )
  })

  it('dedupe is idempotent', () => {
    fc.assert(
      fc.property(fc.array(lineArb), (lines) => {
        const op: Op = {
          kind: 'dedupe',
          caseSensitive: true,
          trimKey: false,
          keep: 'first',
          output: 'unique',
        }
        const once = applyOp(parseLines(lines.join('\n')), op)
        expect(applyOp(once, op).lines).toEqual(once.lines)
      }),
      { numRuns: 200 },
    )
  })

  it('shuffle always returns a permutation', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1 }), (lines) => {
        const d = parseLines(lines.join('\n'))
        const out = applyOp(d, { kind: 'shuffle', source: 'crypto' })
        expect(out.lines.toSorted()).toEqual(d.lines.toSorted())
      }),
      { numRuns: 200 },
    )
  })

  it('sort never adds or loses lines when blanks are kept', () => {
    fc.assert(
      fc.property(fc.array(lineArb), (lines) => {
        const d = parseLines(lines.join('\n'))
        const out = applyOp(d, { ...SORT, mode: 'codepoint', blanks: 'keep' })
        expect(out.lines.length).toBe(d.lines.length)
      }),
      { numRuns: 200 },
    )
  })
})
