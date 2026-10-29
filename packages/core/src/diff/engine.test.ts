import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MAX_REFINE_CHARS, computeDiff } from './engine.ts'
import { keysFor, NO_IGNORE, type IgnoreOptions } from './ignore.ts'
import { splitLines } from './tokens.ts'

type Quad = [number, number, number, number]

function quads(q: Int32Array): Quad[] {
  const out: Quad[] = []
  for (let i = 0; i < q.length; i += 4) out.push([q[i]!, q[i + 1]!, q[i + 2]!, q[i + 3]!])
  return out
}

/** Replace every A range with its B range. With exact keys this must give `b`. */
function rebuild(a: string, b: string, q: Int32Array): string {
  let out = ''
  let pos = 0
  for (const [fromA, toA, fromB, toB] of quads(q)) {
    out += a.slice(pos, fromA) + b.slice(fromB, toB)
    pos = toA
  }
  return out + a.slice(pos)
}

const lineArb = fc.string({ unit: fc.constantFrom('a', 'b', 'A', ' ', '\t', 'x', 'é', '😀'), maxLength: 6 })
const docArb = fc
  .array(fc.tuple(lineArb, fc.constantFrom('\n', '\r\n', '')), { maxLength: 12 })
  .map((parts) => parts.map(([line, end]) => line + end).join(''))
const ignoreArb = fc.record({ whitespace: fc.boolean(), case: fc.boolean(), trim: fc.boolean() })

const exact = (a: string, b: string, refine = true) => computeDiff(a, b, { refine })!
const withIgnore = (o: IgnoreOptions, a: string, b: string) =>
  computeDiff(a, b, { keys: keysFor(o), refine: true })!
const onBoundary = (s: string, i: number) => i === 0 || i === s.length || s[i - 1] === '\n'

// Each side's lines, split by whether some changed run covers them.
function partition(text: string, runs: [number, number][]) {
  const changed: string[] = []
  const same: string[] = []
  let start = 0
  for (const line of splitLines(text)) {
    const hit = runs.some(([from, to]) => from <= start && start < to)
    ;(hit ? changed : same).push(line.trimEnd())
    start += line.length
  }
  return { changed, same }
}

describe('computeDiff', () => {
  it('finds nothing in identical input', () => {
    const r = exact('same\ntext\n', 'same\ntext\n')
    expect(quads(r.lines)).toEqual([])
    expect(quads(r.changes)).toEqual([])
    expect(quads(exact('', '').lines)).toEqual([])
  })

  it('aligns lines, then highlights only the changed token', () => {
    const r = exact('a\nb\nc\n', 'a\nX\nc\n')
    expect(quads(r.lines)).toEqual([[2, 4, 2, 4]])
    expect(quads(r.changes)).toEqual([[2, 3, 2, 3]])
  })

  it('highlights a whole word, not stray characters', () => {
    const r = exact('const foo = 1\n', 'const bar = 1\n')
    expect(quads(r.lines)).toEqual([[0, 14, 0, 14]])
    expect(quads(r.changes)).toEqual([[6, 9, 6, 9]])
  })

  it('keeps separate edits on one line separate', () => {
    expect(quads(exact('a b c\n', 'x b y\n').changes)).toEqual([
      [0, 1, 0, 1],
      [4, 5, 4, 5],
    ])
  })

  it('reports a pure insertion as one whole-line change', () => {
    const r = exact('a\n', 'a\nb\n')
    expect(quads(r.lines)).toEqual([[2, 2, 2, 4]])
    expect(quads(r.changes)).toEqual([[2, 2, 2, 4]])
  })

  it('does not refine when refine is off', () => {
    const r = exact('a b c\n', 'x b y\n', false)
    expect(quads(r.changes)).toEqual(quads(r.lines))
  })

  it('does not refine a run longer than MAX_REFINE_CHARS', () => {
    const a = 'x'.repeat(MAX_REFINE_CHARS + 1) + '\n'
    const b = 'y'.repeat(MAX_REFINE_CHARS + 1) + '\n'
    const r = exact(a, b)
    expect(quads(r.changes)).toEqual([[0, a.length, 0, b.length]])
  })

  it('stops refining once the shared budget is spent', () => {
    // First call sets the deadline at 0 + budget; every later call is past it.
    let t = 0
    const now = () => {
      const v = t
      t = 1_000
      return v
    }
    const r = computeDiff('a b\nx\nc d\n', 'a B\nx\nc D\n', { refine: true, now })!
    expect(quads(r.lines)).toEqual([
      [0, 4, 0, 4],
      [6, 10, 6, 10],
    ])
    expect(quads(r.changes)).toEqual(quads(r.lines))
  })

  it('aligns thousands of scattered single-line edits in time', () => {
    // Every other line edited: too slow for plain Myers inside the time limit,
    // instant once lines unique to one side are set aside.
    const base = Array.from({ length: 5000 }, (_, i) => `line ${i} alpha beta\n`)
    const a = base.join('')
    const b = base.map((l, i) => (i % 2 ? l.replace('beta', 'BETA') : l)).join('')
    const r = computeDiff(a, b, { refine: true })
    expect(r).not.toBeNull()
    expect(quads(r!.lines)).toHaveLength(2500)
    expect(rebuild(a, b, r!.changes)).toBe(b)
  })

  it('returns null when the line stage cannot finish in time', () => {
    // Every line exists on both sides, just scrambled, so nothing can be set
    // aside and Myers has to do all the work.
    const a = Array.from({ length: 40_000 }, (_, i) => `v${i % 500}\n`).join('')
    const b = Array.from({ length: 40_000 }, (_, i) => `v${(i * 37) % 500}\n`).join('')
    expect(computeDiff(a, b, { refine: true })).toBeNull()
  })

  it('treats two unrelated documents as one replaced block, without timing out', () => {
    const a = Array.from({ length: 40_000 }, (_, i) => `x${i}\n`).join('')
    const b = Array.from({ length: 40_000 }, (_, i) => `y${i}\n`).join('')
    const r = computeDiff(a, b, { refine: true })
    expect(r).not.toBeNull()
    expect(quads(r!.lines)).toEqual([[0, a.length, 0, b.length]])
  })

  it('leaves untouched config blocks unmarked between scattered edits', () => {
    // A reported case: CodeMirror's own diff gave up on this pair and marked
    // every line, including the identical `networking:` block, as changed.
    const a = [
      'env: dev', '', 'networking:', '  host: 0.0.0.0', '  port: 3000', '  timeout: 10 # seconds', '',
      'auth:', '  token-expiration-in-seconds: 3600', '',
      'powercred:', '  create-session-timeout: 8 # seconds', '',
      'powercred-api:', '  max-retries: 3', '  timeouts:',
      '    callback: 10 # seconds', '    download: 10 # seconds', '    journey: 10 # seconds',
      '    liveness: 10 # seconds', '    ocr: 10 # seconds', '    threshold: 10 # seconds', '',
      'vendor:', '  aws:', '    sqs:', '      max-messages-per-poll: 10', '      long-polling-wait-time: 20',
      '    eventbridge:', '      event-bus-name: PaymongoCentralEventBus', '',
    ].join('\n')
    const b = [
      'env: stg', '', 'networking:', '  host: 0.0.0.0', '  port: 3000', '  timeout: 10 # seconds', '',
      'auth:', '  issuer: "https://auth.paymongo-stg.com"', '  token-expiration-in-seconds: 3600', '',
      'powercred:', '  api-key: ""', '  secret: ""', '  base-url: "http://mock.powercred.io"',
      '  webhook-base-url: "https://verifications-api.paymongo-stg.com/v1/webhook/powercred_session"',
      '  create-session-timeout: 8 # seconds', '',
      'powercred-api:', '  max-retries: 3', '  timeouts:',
      '    callback: 60 # seconds', '    download: 60 # seconds', '    journey: 60 # seconds',
      '    liveness: 60 # seconds', '    ocr: 60 # seconds', '    threshold: 60 # seconds', '',
      'vendor:', '  aws:', '    dynamodb:', '      rules-table: "verifications-api-rules-stg"',
      '      verifications-table: "verifications-api-verifications-stg"',
      '    sqs:', '      verifier-queue: "verifications-api-verifier.fifo"',
      '      max-messages-per-poll: 10', '      long-polling-wait-time: 20',
      '    eventbridge:', '      event-bus-name: PaymongoCentralEventBus', '',
      'paymongo:', '  core-api:', '    api-key: ""', '    base-url: "https://api.paymongo-stg.com"',
      '  merchants-api:', '    api-key: ""', '    base-url: "https://merchants-api.paymongo-stg.com"',
      '  files-api:', '    api-key: ""', '    base-url: "https://files-api.paymongo-stg.com"',
      '  onboarding-api:', '    api-key: ""', '    base-url: "https://onboarding-api.paymongo-stg.com"',
      '    issuer: "https://auth.paymongo-stg.com"', '',
    ].join('\n')

    const runs = quads(exact(a, b).lines)
    const left = partition(a, runs.map(([fromA, toA]) => [fromA, toA]))
    const right = partition(b, runs.map(([, , fromB, toB]) => [fromB, toB]))

    expect(left.changed).toEqual([
      'env: dev',
      '    callback: 10 # seconds',
      '    download: 10 # seconds',
      '    journey: 10 # seconds',
      '    liveness: 10 # seconds',
      '    ocr: 10 # seconds',
      '    threshold: 10 # seconds',
    ])
    expect(right.same).toEqual(left.same)
    expect(right.same).toContain('networking:')
  })

  describe('with ignore keys', () => {
    it('whitespace: a spacing-only change is no change', () => {
      expect(quads(withIgnore({ ...NO_IGNORE, whitespace: true }, 'a  b\nc\n', 'a b\nc\n').lines)).toEqual([])
    })

    it('case: offsets still index the original text', () => {
      const a = 'FOO bar\n'
      const r = withIgnore({ ...NO_IGNORE, case: true }, a, 'foo baz\n')
      expect(quads(r.changes)).toEqual([[4, 7, 4, 7]])
      expect(a.slice(4, 7)).toBe('bar')
    })

    it('whitespace: a moved line break is still highlighted', () => {
      const r = withIgnore({ ...NO_IGNORE, whitespace: true }, 'one two\n', 'one\ntwo\n')
      expect(quads(r.lines)).toHaveLength(1)
      expect(quads(r.changes).length).toBeGreaterThan(0)
    })

    it('trim: CRLF against LF is no change', () => {
      expect(quads(withIgnore({ ...NO_IGNORE, trim: true }, 'a\r\nb\r\n', 'a\nb\n').lines)).toEqual([])
    })
  })

  describe('properties', () => {
    it('exact: replacing every change reproduces b, and the gaps are identical', () => {
      fc.assert(
        fc.property(docArb, docArb, fc.boolean(), (a, b, refine) => {
          const r = exact(a, b, refine)
          expect(rebuild(a, b, r.changes)).toBe(b)
          expect(rebuild(a, b, r.lines)).toBe(b)
        }),
      )
    })

    it('any options: quads are ordered, line-aligned, nested, and gaps equal under the key', () => {
      fc.assert(
        fc.property(docArb, docArb, ignoreArb, fc.boolean(), (a, b, ignore, refine) => {
          const keys = keysFor(ignore)
          const r = computeDiff(a, b, { keys, refine })!
          const lines = quads(r.lines)
          const changes = quads(r.changes)

          for (const list of [lines, changes]) {
            let prevA = 0
            let prevB = 0
            for (const [fromA, toA, fromB, toB] of list) {
              expect(prevA <= fromA && fromA <= toA && toA <= a.length).toBe(true)
              expect(prevB <= fromB && fromB <= toB && toB <= b.length).toBe(true)
              prevA = toA
              prevB = toB
            }
          }

          for (const [fromA, toA, fromB, toB] of lines) {
            expect([fromA, toA].every((i) => onBoundary(a, i))).toBe(true)
            expect([fromB, toB].every((i) => onBoundary(b, i))).toBe(true)
          }

          for (const [fromA, toA, fromB, toB] of changes) {
            const inside = lines.some(
              ([lfA, ltA, lfB, ltB]) => lfA <= fromA && toA <= ltA && lfB <= fromB && toB <= ltB,
            )
            expect(inside).toBe(true)
          }

          // Every counted run has something to see: a run with no highlight
          // would inflate the stats with a change the view cannot show.
          for (const [lfA, ltA, lfB, ltB] of lines) {
            const shown = changes.some(
              ([fromA, toA, fromB, toB]) => lfA <= fromA && toA <= ltA && lfB <= fromB && toB <= ltB,
            )
            expect(shown).toBe(true)
          }

          const key = keys?.line ?? ((s: string) => s)
          let posA = 0
          let posB = 0
          for (const [fromA, toA, fromB, toB] of [...lines, [a.length, a.length, b.length, b.length] as Quad]) {
            const gapA = splitLines(a.slice(posA, fromA)).map(key)
            const gapB = splitLines(b.slice(posB, fromB)).map(key)
            expect(gapA).toEqual(gapB)
            posA = toA
            posB = toB
          }
        }),
      )
    })
  })
})
