import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseLines, serializeLines } from './lines'
import {
  appliesNormalizationCheck,
  defaultOp,
  isOpKind,
  moveStep,
  OP_KINDS,
  OP_LABELS,
  summarizeOp,
  withRouteKind,
  type Step,
} from './ops'
import { runPipeline } from './pipeline'
import type { Op } from './types'

const step = (op: Op, id = 's1'): Step => ({ id, op, enabled: true })

describe('OP_KINDS', () => {
  it('covers every kind in the Op union exactly once', () => {
    expect(new Set(OP_KINDS).size).toBe(OP_KINDS.length)
    expect([...OP_KINDS].toSorted()).toEqual(Object.keys(OP_LABELS).toSorted())
  })

  it.each(OP_KINDS)('defaultOp(%s) runs without error and has a summary', (kind) => {
    const op = defaultOp(kind)
    expect(op.kind).toBe(kind)
    const { steps } = runPipeline(parseLines('b\na\n\nc, d\na'), [op])
    expect(steps[0]!.error).toBeUndefined()
    expect(summarizeOp(op)).not.toBe('')
  })

  it('isOpKind rejects prototype keys and unknown slugs', () => {
    expect(isOpKind('sort')).toBe(true)
    expect(isOpKind('toString')).toBe(false)
    expect(isOpKind('')).toBe(false)
  })
})

describe('the chain no free tool does in one screen', () => {
  it('dedupe → natural sort → prefix sk_live_', () => {
    const ops: Op[] = [
      defaultOp('dedupe'),
      defaultOp('sort'),
      { kind: 'affix', prefix: 'sk_live_', suffix: '', skipBlank: true },
    ]
    const { doc, steps } = runPipeline(parseLines('key10\nkey2\nKEY2\nkey1\n'), ops)
    expect(serializeLines(doc)).toBe('sk_live_key1\nsk_live_key2\nsk_live_key10\n')
    expect(steps.map((s) => [s.inLines, s.outLines])).toEqual([
      [4, 3],
      [3, 3],
      [3, 3],
    ])
  })

  it('a bad regex fails its own step and leaves the rest running', () => {
    const ops: Op[] = [
      { kind: 'filter', action: 'keep', test: { t: 'regex', source: '(', flags: '' } },
      defaultOp('reverse'),
    ]
    const { doc, steps } = runPipeline(parseLines('a\nb'), ops)
    expect(steps[0]!.error).toMatch(/regular expression/i)
    expect(doc.lines).toEqual(['b', 'a'])
  })
})

describe('summarizeOp', () => {
  it('quotes values so whitespace is visible', () => {
    expect(summarizeOp({ kind: 'join', separator: ' ' })).toBe('Into one line with " "')
    expect(summarizeOp({ kind: 'affix', prefix: 'sk_', suffix: '', skipBlank: true })).toBe(
      'Prefix "sk_"',
    )
  })

  it('shows slice bounds 1-based, as the user counts lines', () => {
    expect(summarizeOp({ kind: 'slice', from: 0, to: 10 })).toBe('Lines 1–10')
    expect(summarizeOp({ kind: 'slice', from: 4 })).toBe('From line 5')
  })
})

describe('moveStep', () => {
  it('moves an item and keeps the rest in order', () => {
    expect(moveStep(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveStep(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('is a no-op out of range', () => {
    expect(moveStep(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveStep(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
  })

  it('is always a permutation, and moving back restores the original', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 20 }).chain((xs) =>
          fc.tuple(
            fc.constant(xs),
            fc.nat({ max: xs.length - 1 }),
            fc.nat({ max: xs.length - 1 }),
          ),
        ),
        ([xs, from, to]) => {
          const moved = moveStep(xs, from, to)
          expect(moved.toSorted()).toEqual(xs.toSorted())
          expect(moved[to]).toBe(xs[from])
          expect(moveStep(moved, to, from)).toEqual(xs)
        },
      ),
    )
  })
})

describe('appliesNormalizationCheck', () => {
  it('flags only the steps that decide "same line or not"', () => {
    expect(appliesNormalizationCheck(defaultOp('dedupe'))).toBe(true)
    expect(appliesNormalizationCheck(defaultOp('setop'))).toBe(true)
    expect(
      appliesNormalizationCheck({ kind: 'filter', action: 'remove', test: { t: 'duplicate' } }),
    ).toBe(true)
    expect(appliesNormalizationCheck(defaultOp('filter'))).toBe(false)
    expect(appliesNormalizationCheck(defaultOp('sort'))).toBe(false)
  })
})

describe('withRouteKind', () => {
  it('passes through with no route kind', () => {
    const steps = [step(defaultOp('sort'))]
    expect(withRouteKind(steps, undefined)).toBe(steps)
  })

  it('swaps a single step to the linked kind', () => {
    const out = withRouteKind([step(defaultOp('sort'))], 'dedupe')
    expect(out).toHaveLength(1)
    expect(out[0]!.op).toEqual(defaultOp('dedupe'))
    expect(out[0]!.id).toBe('s1')
  })

  it('keeps a matching single step, options and all', () => {
    const steps = [step({ ...defaultOp('sort'), order: 'desc' } as Op)]
    expect(withRouteKind(steps, 'sort')).toBe(steps)
  })

  it('never clobbers a real chain', () => {
    const steps = [step(defaultOp('sort')), step(defaultOp('reverse'), 's2')]
    expect(withRouteKind(steps, 'dedupe')).toBe(steps)
  })

  it('fills an empty pipeline', () => {
    expect(withRouteKind([], 'shuffle')[0]!.op.kind).toBe('shuffle')
  })
})
