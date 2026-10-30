import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { encodeCompact } from '../share/compact.ts'
import { parseLines } from './lines.ts'
import { CASE_LABELS, defaultOp, OP_KINDS } from './ops.ts'
import { runPipeline } from './pipeline.ts'
import {
  decodePipeline,
  encodePipeline,
  MAX_FIELD_CHARS,
  MAX_PAD,
  MAX_SHARED_STEPS,
  parseOp,
  parseOps,
  parseSharedSteps,
  PIPELINE_PARAM,
  type SharedStep,
} from './share.ts'
import type { CaseTarget, LineTest, Op } from './types.ts'

const text = fc.string({ maxLength: 40 })
const bool = fc.boolean()
const num = fc.double({ noNaN: true, noDefaultInfinity: true })

const testArb: fc.Arbitrary<LineTest> = fc.oneof(
  fc.record({ t: fc.constant('regex' as const), source: text, flags: fc.constantFrom('', 'i', 'gimsu') }),
  fc.record({ t: fc.constant('contains' as const), needle: text, ci: bool }),
  fc.constant({ t: 'blank' as const }),
  fc.record({ t: fc.constant('index' as const), ranges: text }),
  fc.constant({ t: 'duplicate' as const }),
)

/** Every shape the `Op` union allows, within the share bounds. */
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record(
    {
      kind: fc.constant('sort' as const),
      order: fc.constantFrom('asc' as const, 'desc' as const),
      mode: fc.constantFrom('codepoint' as const, 'locale' as const, 'natural' as const, 'length' as const, 'random' as const),
      caseSensitive: bool,
      locale: fc.constantFrom('en', 'de-DE', 'tr'),
      blanks: fc.constantFrom('keep' as const, 'first' as const, 'last' as const, 'drop' as const),
    },
    { requiredKeys: ['kind', 'order', 'mode', 'caseSensitive', 'blanks'] },
  ),
  fc.record({
    kind: fc.constant('dedupe' as const),
    caseSensitive: bool,
    trimKey: bool,
    keep: fc.constantFrom('first' as const, 'last' as const),
    output: fc.constantFrom('unique' as const, 'duplicates-only' as const, 'unique-only' as const, 'with-counts' as const),
  }),
  fc.record(
    {
      kind: fc.constant('shuffle' as const),
      source: fc.constantFrom('crypto' as const, 'seeded' as const),
      seed: fc.nat({ max: 0xffff_ffff }),
    },
    { requiredKeys: ['kind', 'source'] },
  ),
  fc.constant({ kind: 'reverse' as const }),
  fc.record(
    {
      kind: fc.constant('case' as const),
      target: fc.constantFrom(...(Object.keys(CASE_LABELS) as CaseTarget[])),
      locale: fc.constantFrom('en', 'tr'),
    },
    { requiredKeys: ['kind', 'target'] },
  ),
  fc.record({ kind: fc.constant('affix' as const), prefix: text, suffix: text, skipBlank: bool }),
  fc.record({ kind: fc.constant('filter' as const), action: fc.constantFrom('keep' as const, 'remove' as const), test: testArb }),
  fc.record({
    kind: fc.constant('number' as const),
    start: num,
    step: num,
    pad: fc.nat({ max: MAX_PAD }),
    padChar: fc.constantFrom('', '0', ' ', '😀'),
    separator: text,
    position: fc.constantFrom('prefix' as const, 'suffix' as const),
    skipBlank: bool,
  }),
  fc.record({ kind: fc.constant('wrap' as const), width: num, breakWords: bool, preserveIndent: bool }),
  fc.record(
    { kind: fc.constant('join' as const), separator: text, chunkSize: fc.integer({ min: 1, max: 1000 }) },
    { requiredKeys: ['kind', 'separator'] },
  ),
  fc.record({
    kind: fc.constant('split' as const),
    by: fc.oneof(
      fc.record({ t: fc.constant('literal' as const), s: text }),
      fc.record({ t: fc.constant('regex' as const), source: text, flags: fc.constantFrom('', 'u') }),
    ),
  }),
  fc.record({ kind: fc.constant('trim' as const), leading: bool, trailing: bool, collapseInternal: bool }),
  fc.record({ kind: fc.constant('normalize' as const), form: fc.constantFrom('NFC' as const, 'NFD' as const, 'NFKC' as const, 'NFKD' as const) }),
  fc.record({
    kind: fc.constant('setop' as const),
    op: fc.constantFrom('union' as const, 'intersection' as const, 'difference' as const, 'symmetric-difference' as const),
    other: fc.string({ maxLength: 400 }),
    caseSensitive: bool,
    bag: bool,
  }),
  fc.record({ kind: fc.constant('slice' as const), from: num, to: num }, { requiredKeys: ['kind', 'from'] }),
)

const stepArb: fc.Arbitrary<SharedStep> = fc.record({ op: opArb, enabled: bool })

const filter = (test: unknown) => parseOp({ kind: 'filter', action: 'keep', test })

/** JSON can only carry what JSON.stringify keeps: -0 becomes 0. */
const viaJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('parseOp', () => {
  it.each(OP_KINDS)('accepts the default %s op unchanged', (kind) => {
    expect(parseOp(defaultOp(kind))).toEqual(defaultOp(kind))
  })

  it('accepts every valid op as itself', () => {
    fc.assert(
      fc.property(opArb, (op) => {
        expect(parseOp(viaJson(op))).toEqual(viaJson(op))
      }),
    )
  })

  it('never throws on arbitrary JSON', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        parseOp(v)
        parseOps(v)
        parseSharedSteps(v)
      }),
      { numRuns: 500 },
    )
  })

  it('never throws on near-miss ops', () => {
    // A valid op with one field replaced by an arbitrary value: the shape that
    // reaches the type checks rather than bouncing off the kind.
    const nearMiss = opArb.chain((op) =>
      fc.tuple(fc.constantFrom(...Object.keys(op)), fc.jsonValue()).map(([k, v]) => ({ ...op, [k]: v })),
    )
    fc.assert(
      fc.property(nearMiss, (v) => {
        const parsed = parseOp(v)
        if (parsed !== null) expect(parseOp(parsed)).toEqual(parsed)
      }),
      { numRuns: 500 },
    )
  })

  it('rejects non-objects and unknown kinds', () => {
    for (const v of [null, 1, 'sort', [], [{ kind: 'sort' }], { kind: 'toString' }, { kind: 'eval' }, {}]) {
      expect(parseOp(v)).toBeNull()
    }
  })

  it('drops unknown fields', () => {
    const hostile = JSON.parse('{"kind":"reverse","evil":"x","__proto__":{"polluted":true}}') as unknown
    const parsed = parseOp(hostile)
    expect(parsed).toEqual({ kind: 'reverse' })
    expect(Object.keys(parsed!)).toEqual(['kind'])
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(parseOp({ ...defaultOp('trim'), extra: 1 })).toEqual(defaultOp('trim'))
  })

  it('rejects a missing required field', () => {
    const { caseSensitive: _, ...sort } = defaultOp('sort') as Extract<Op, { kind: 'sort' }>
    expect(parseOp(sort)).toBeNull()
  })

  it('rejects wrong types', () => {
    expect(parseOp({ ...defaultOp('sort'), caseSensitive: 'yes' })).toBeNull()
    expect(parseOp({ ...defaultOp('affix'), prefix: 1 })).toBeNull()
    expect(parseOp({ ...defaultOp('wrap'), width: '80' })).toBeNull()
  })

  it('rejects values outside an enum', () => {
    expect(parseOp({ ...defaultOp('sort'), mode: 'bogus' })).toBeNull()
    expect(parseOp({ ...defaultOp('sort'), blanks: 'middle' })).toBeNull()
    expect(parseOp({ ...defaultOp('dedupe'), output: 'all' })).toBeNull()
    expect(parseOp({ ...defaultOp('case'), target: 'toString' })).toBeNull()
    expect(parseOp({ ...defaultOp('normalize'), form: 'NFX' })).toBeNull()
    expect(parseOp({ ...defaultOp('setop'), op: 'xor' })).toBeNull()
    expect(parseOp({ ...defaultOp('number'), position: 'middle' })).toBeNull()
    expect(parseOp({ ...defaultOp('shuffle'), source: 'math' })).toBeNull()
  })

  it('rejects an invalid optional field rather than dropping it', () => {
    expect(parseOp({ ...defaultOp('sort'), locale: 'not a locale!!' })).toBeNull()
    expect(parseOp({ ...defaultOp('sort'), locale: 42 })).toBeNull()
    expect(parseOp({ ...defaultOp('join'), chunkSize: 0 })).toBeNull()
    expect(parseOp({ ...defaultOp('slice'), to: '10' })).toBeNull()
    expect(parseOp({ kind: 'shuffle', source: 'seeded', seed: -1 })).toBeNull()
  })

  it('bounds the values that could hang or exhaust memory', () => {
    expect(parseOp({ ...defaultOp('number'), pad: MAX_PAD + 1 })).toBeNull()
    expect(parseOp({ ...defaultOp('number'), pad: 1.5 })).toBeNull()
    expect(parseOp({ ...defaultOp('number'), padChar: 'ab' })).toBeNull()
    expect(parseOp({ ...defaultOp('join'), chunkSize: 1e-9 })).toBeNull()
    expect(parseOp({ ...defaultOp('affix'), prefix: 'x'.repeat(MAX_FIELD_CHARS + 1) })).toBeNull()
    expect(parseOp({ ...defaultOp('affix'), prefix: 'x'.repeat(MAX_FIELD_CHARS) })).not.toBeNull()
  })

  it('checks every variant of the filter test', () => {
    expect(filter({ t: 'regex', source: 'a+', flags: 'i' })).not.toBeNull()
    expect(filter({ t: 'regex', source: 'a+' })).toBeNull()
    expect(filter({ t: 'contains', needle: 'x', ci: 'no' })).toBeNull()
    expect(filter({ t: 'blank', extra: 1 })).toEqual({ kind: 'filter', action: 'keep', test: { t: 'blank' } })
    expect(filter({ t: 'index', ranges: 5 })).toBeNull()
    expect(filter({ t: 'duplicate' })).not.toBeNull()
    expect(filter({ t: 'eval' })).toBeNull()
    expect(filter('blank')).toBeNull()
    expect(parseOp({ kind: 'filter', test: { t: 'blank' } })).toBeNull()
  })

  it('checks both split variants', () => {
    expect(parseOp({ kind: 'split', by: { t: 'literal', s: ',' } })).not.toBeNull()
    expect(parseOp({ kind: 'split', by: { t: 'literal' } })).toBeNull()
    expect(parseOp({ kind: 'split', by: { t: 'regex', source: ',', flags: 'x'.repeat(17) } })).toBeNull()
    expect(parseOp({ kind: 'split', by: { t: 'other', s: ',' } })).toBeNull()
    expect(parseOp({ kind: 'split' })).toBeNull()
  })
})

describe('parseOps', () => {
  it('rejects the whole array on one bad op', () => {
    expect(parseOps([defaultOp('sort'), { kind: 'sort' }])).toBeNull()
    expect(parseOps([defaultOp('sort'), defaultOp('reverse')])).toHaveLength(2)
  })

  it('caps the number of steps', () => {
    expect(parseOps(Array.from({ length: MAX_SHARED_STEPS }, () => defaultOp('reverse')))).not.toBeNull()
    expect(parseOps(Array.from({ length: MAX_SHARED_STEPS + 1 }, () => defaultOp('reverse')))).toBeNull()
  })
})

describe('encodePipeline / decodePipeline', () => {
  it('round-trips any valid pipeline, enabled flags and all', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 8 }), async (steps) => {
        const encoded = await encodePipeline(steps)
        expect(encoded).not.toBeNull()
        expect(await decodePipeline(`#${PIPELINE_PARAM}=${encoded!}`)).toEqual(viaJson(steps))
      }),
      { numRuns: 100 },
    )
  })

  it('accepts the bare value as well as the fragment', async () => {
    const encoded = (await encodePipeline([{ op: defaultOp('sort'), enabled: false }]))!
    expect(await decodePipeline(encoded)).toEqual([{ op: defaultOp('sort'), enabled: false }])
  })

  it('is URL-safe and carries no ids', async () => {
    const encoded = (await encodePipeline([{ op: defaultOp('dedupe'), enabled: true }]))!
    expect(encoded).toMatch(/^1\.[A-Za-z0-9_-]+$/)
    const withId = { id: 'secret-id', op: defaultOp('dedupe'), enabled: true }
    expect(await encodePipeline([withId])).toBe(encoded)
  })

  it('declines what a receiver would reject', async () => {
    expect(await encodePipeline([])).toBeNull()
    expect(await encodePipeline([{ op: { ...defaultOp('number'), pad: 1e9 } as Op, enabled: true }])).toBeNull()
  })

  it('returns null for arbitrary strings, never throws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (s) => {
        expect(await decodePipeline(s)).toBeNull()
        expect(await decodePipeline(`#p=${s}`)).toBeNull()
      }),
      { numRuns: 200 },
    )
  })

  it('returns null for a valid encoding of the wrong payload', async () => {
    const steps = [{ op: defaultOp('reverse'), on: true }]
    expect(await decodePipeline(await encodeCompact({ v: 2, steps }))).toBeNull()
    expect(await decodePipeline(await encodeCompact({ v: 1, steps: [] }))).toBeNull()
    expect(await decodePipeline(await encodeCompact({ v: 1, steps: [{ op: defaultOp('reverse') }] }))).toBeNull()
    expect(await decodePipeline(await encodeCompact([defaultOp('reverse')]))).toBeNull()
    expect(await decodePipeline(await encodeCompact({ v: 1, steps }))).toEqual([
      { op: defaultOp('reverse'), enabled: true },
    ])
  })

  it('returns null for arbitrary JSON payloads, never throws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (v) => {
        const r = await decodePipeline(await encodeCompact(v))
        if (r !== null) expect(r.length).toBeGreaterThan(0)
      }),
      { numRuns: 200 },
    )
  })

  it('refuses a payload that inflates past the cap', async () => {
    // Valid steps, plus an unknown field that would otherwise just be dropped.
    const huge = { v: 1, steps: [{ op: defaultOp('reverse'), on: true }], junk: 'x'.repeat(2_000_000) }
    expect(await decodePipeline(await encodeCompact(huge))).toBeNull()
  })

  it('a decoded pipeline runs', async () => {
    const steps: SharedStep[] = [
      { op: { kind: 'filter', action: 'remove', test: { t: 'blank' } }, enabled: true },
      { op: defaultOp('dedupe'), enabled: true },
      { op: { kind: 'affix', prefix: '- ', suffix: '', skipBlank: true }, enabled: false },
    ]
    const back = (await decodePipeline((await encodePipeline(steps))!))!
    const ops = back.filter((s) => s.enabled).map((s) => s.op)
    expect(runPipeline(parseLines('b\n\nb\na'), ops).doc.lines).toEqual(['b', 'a'])
  })
})

describe('index ranges', () => {
  it('selects within a huge range without walking all of it', () => {
    const op: Op = { kind: 'filter', action: 'keep', test: { t: 'index', ranges: '2-999999999999999' } }
    expect(runPipeline(parseLines('a\nb\nc'), [op]).doc.lines).toEqual(['b', 'c'])
  })
})
