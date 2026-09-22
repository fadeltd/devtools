import { applyCase } from './casing'
import { comparatorFor } from './compare'
import { isBlank, parseLines, withLines } from './lines'
import { cryptoRandomSource, mulberry32, shuffleInPlace } from './shuffle'
import type { BlankPolicy, LineDoc, LineTest, Op, StepStat } from './types'

function partitionBlanks(lines: string[], policy: BlankPolicy) {
  if (policy === 'keep') return { body: lines, blanks: [] as string[], policy }
  const body: string[] = []
  const blanks: string[] = []
  for (const line of lines) (isBlank(line) ? blanks : body).push(line)
  return { body, blanks, policy }
}

function reattachBlanks(
  body: string[],
  blanks: string[],
  policy: BlankPolicy,
): string[] {
  switch (policy) {
    case 'keep':
      return body
    case 'drop':
      return body
    case 'first':
      return [...blanks, ...body]
    case 'last':
      return [...body, ...blanks]
  }
}

function dedupeKey(line: string, caseSensitive: boolean, trimKey: boolean): string {
  let k = trimKey ? line.trim() : line
  // Normalize before casefolding so "café" in NFC and NFD share a key.
  k = k.normalize('NFC')
  return caseSensitive ? k : k.toLowerCase()
}

function parseIndexRanges(spec: string, length: number): Set<number> {
  const out = new Set<number>()
  for (const part of spec.split(',')) {
    const t = part.trim()
    if (t === '') continue
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(t)
    if (m) {
      const a = Number(m[1])
      const b = Number(m[2])
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
        if (i >= 1 && i <= length) out.add(i - 1)
      }
    } else if (/^\d+$/.test(t)) {
      const i = Number(t)
      if (i >= 1 && i <= length) out.add(i - 1)
    }
  }
  return out
}

function testMatcher(test: LineTest, lines: string[]): (line: string, i: number) => boolean {
  switch (test.t) {
    case 'regex': {
      // Constructed once, not per line. An invalid pattern is surfaced as a
      // step error by applyOp's caller rather than thrown at the user.
      const re = new RegExp(test.source, test.flags.replace(/g/g, ''))
      return (line) => re.test(line)
    }
    case 'contains': {
      const needle = test.ci ? test.needle.toLowerCase() : test.needle
      return (line) => (test.ci ? line.toLowerCase() : line).includes(needle)
    }
    case 'blank':
      return (line) => isBlank(line)
    case 'index': {
      const set = parseIndexRanges(test.ranges, lines.length)
      return (_line, i) => set.has(i)
    }
    case 'duplicate': {
      const seen = new Set<string>()
      const dupes = new Set<string>()
      for (const line of lines) {
        if (seen.has(line)) dupes.add(line)
        else seen.add(line)
      }
      return (line) => dupes.has(line)
    }
  }
}

function wrapLine(line: string, width: number, breakWords: boolean, preserveIndent: boolean) {
  if (width <= 0) return [line]
  const indent = preserveIndent ? (/^\s*/.exec(line)?.[0] ?? '') : ''
  const content = preserveIndent ? line.slice(indent.length) : line
  if (content === '') return [line]

  // Intl.Segmenter finds break opportunities in scripts without spaces too.
  const seg = new Intl.Segmenter(undefined, { granularity: 'word' })
  const tokens = [...seg.segment(content)].map((s) => s.segment)

  const out: string[] = []
  let current = ''
  const push = () => {
    out.push(indent + current)
    current = ''
  }

  for (const token of tokens) {
    if ((indent + current + token).length <= width || current === '') {
      if (current === '' && (indent + token).length > width && breakWords) {
        // A single token longer than the width: hard-split it.
        let rest = token
        const room = Math.max(1, width - indent.length)
        while (rest.length > room) {
          out.push(indent + rest.slice(0, room))
          rest = rest.slice(room)
        }
        current = rest
        continue
      }
      current += token
    } else {
      push()
      current = token.trimStart() === '' ? '' : token
    }
  }
  if (current !== '') push()
  return out.length > 0 ? out : [line]
}

function setOpLines(
  a: string[],
  bText: string,
  op: Extract<Op, { kind: 'setop' }>,
): string[] {
  const b = parseLines(bText).lines
  const key = (s: string) => (op.caseSensitive ? s : s.normalize('NFC').toLowerCase())

  if (op.bag) {
    // Multiset semantics: multiplicity matters.
    const countB = new Map<string, number>()
    for (const l of b) countB.set(key(l), (countB.get(key(l)) ?? 0) + 1)
    switch (op.op) {
      case 'union':
        return [...a, ...b]
      case 'intersection':
        return a.filter((l) => {
          const k = key(l)
          const n = countB.get(k) ?? 0
          if (n > 0) {
            countB.set(k, n - 1)
            return true
          }
          return false
        })
      case 'difference':
        return a.filter((l) => {
          const k = key(l)
          const n = countB.get(k) ?? 0
          if (n > 0) {
            countB.set(k, n - 1)
            return false
          }
          return true
        })
      case 'symmetric-difference': {
        const countA = new Map<string, number>()
        for (const l of a) countA.set(key(l), (countA.get(key(l)) ?? 0) + 1)
        const onlyA = a.filter((l) => (countB.get(key(l)) ?? 0) === 0)
        const onlyB = b.filter((l) => (countA.get(key(l)) ?? 0) === 0)
        return [...onlyA, ...onlyB]
      }
    }
  }

  // Set semantics (the default): dedupe both sides first. Result order is
  // first-appearance in A, then first-appearance in B.
  const setA = new Set(a.map(key))
  const setB = new Set(b.map(key))
  const firstOf = (lines: string[]) => {
    const seen = new Set<string>()
    return lines.filter((l) => {
      const k = key(l)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  const uniqA = firstOf(a)
  const uniqB = firstOf(b)

  switch (op.op) {
    case 'union':
      return [...uniqA, ...uniqB.filter((l) => !setA.has(key(l)))]
    case 'intersection':
      return uniqA.filter((l) => setB.has(key(l)))
    case 'difference':
      return uniqA.filter((l) => !setB.has(key(l)))
    case 'symmetric-difference':
      return [
        ...uniqA.filter((l) => !setB.has(key(l))),
        ...uniqB.filter((l) => !setA.has(key(l))),
      ]
  }
}

/** Pure: takes a doc and an op, returns a new doc. No React, no DOM, no store. */
export function applyOp(doc: LineDoc, op: Op): LineDoc {
  const lines = doc.lines

  switch (op.kind) {
    case 'sort': {
      if (op.mode === 'random') {
        return applyOp(doc, { kind: 'shuffle', source: 'crypto' })
      }
      const { body, blanks, policy } = partitionBlanks(lines, op.blanks)
      const cmp = comparatorFor(op)
      // Spec-stable since ES2019: equal keys keep their original order for free.
      const sorted = body.toSorted(cmp)
      if (op.order === 'desc') sorted.reverse()
      return withLines(doc, reattachBlanks(sorted, blanks, policy))
    }

    case 'dedupe': {
      const groups = new Map<string, { first: number; last: number; count: number }>()
      lines.forEach((line, i) => {
        const k = dedupeKey(line, op.caseSensitive, op.trimKey)
        const g = groups.get(k)
        if (g) {
          g.last = i
          g.count++
        } else {
          groups.set(k, { first: i, last: i, count: 1 })
        }
      })

      const out: string[] = []
      switch (op.output) {
        case 'unique':
          for (const g of groups.values()) {
            out.push(lines[op.keep === 'first' ? g.first : g.last]!)
          }
          break
        case 'duplicates-only':
          for (const g of groups.values()) {
            if (g.count > 1) out.push(lines[g.first]!)
          }
          break
        case 'unique-only':
          for (const g of groups.values()) {
            if (g.count === 1) out.push(lines[g.first]!)
          }
          break
        case 'with-counts':
          for (const g of groups.values()) {
            out.push(`${g.count}\t${lines[g.first]!}`)
          }
          break
      }
      return withLines(doc, out)
    }

    case 'shuffle': {
      const next =
        op.source === 'seeded' && op.seed !== undefined
          ? mulberry32(op.seed)
          : cryptoRandomSource()
      return withLines(doc, shuffleInPlace([...lines], next))
    }

    case 'reverse':
      return withLines(doc, lines.toReversed())

    case 'case':
      return withLines(
        doc,
        lines.map((l) => applyCase(l, op.target, op.locale)),
      )

    case 'affix':
      return withLines(
        doc,
        lines.map((l) => (op.skipBlank && isBlank(l) ? l : op.prefix + l + op.suffix)),
      )

    case 'filter': {
      const match = testMatcher(op.test, lines)
      return withLines(
        doc,
        lines.filter((l, i) => (op.action === 'keep' ? match(l, i) : !match(l, i))),
      )
    }

    case 'number': {
      let n = op.start
      return withLines(
        doc,
        lines.map((l) => {
          if (op.skipBlank && isBlank(l)) return l
          const label = String(n).padStart(op.pad, op.padChar || ' ')
          n += op.step
          return op.position === 'prefix' ? label + op.separator + l : l + op.separator + label
        }),
      )
    }

    case 'wrap': {
      const out: string[] = []
      for (const l of lines) out.push(...wrapLine(l, op.width, op.breakWords, op.preserveIndent))
      return withLines(doc, out)
    }

    case 'join': {
      if (op.chunkSize === undefined || op.chunkSize <= 0) {
        return withLines(doc, lines.length === 0 ? [] : [lines.join(op.separator)])
      }
      const out: string[] = []
      for (let i = 0; i < lines.length; i += op.chunkSize) {
        out.push(lines.slice(i, i + op.chunkSize).join(op.separator))
      }
      return withLines(doc, out)
    }

    case 'split': {
      const by = op.by
      const sep =
        by.t === 'literal' ? by.s : new RegExp(by.source, by.flags.replace(/g/g, ''))
      const out: string[] = []
      for (const l of lines) out.push(...l.split(sep as string))
      return withLines(doc, out)
    }

    case 'trim':
      return withLines(
        doc,
        lines.map((l) => {
          let s = l
          if (op.leading) s = s.replace(/^\s+/, '')
          if (op.trailing) s = s.replace(/\s+$/, '')
          if (op.collapseInternal) s = s.replace(/[^\S\r\n]{2,}/g, ' ')
          return s
        }),
      )

    case 'normalize':
      return withLines(
        doc,
        lines.map((l) => l.normalize(op.form)),
      )

    case 'setop':
      return withLines(doc, setOpLines(lines, op.other, op))

    case 'slice': {
      const from = Math.max(0, op.from)
      return withLines(doc, lines.slice(from, op.to))
    }
  }
}

export interface PipelineResult {
  doc: LineDoc
  steps: StepStat[]
}

/**
 * Run a chain of ops, recording per-step in/out line counts.
 *
 * The counts are the point: they let you see *which* step ate your data, which
 * no free list tool shows. A failing step is recorded and skipped rather than
 * aborting the run, so one bad regex does not throw away the rest.
 */
export function runPipeline(doc: LineDoc, ops: readonly Op[]): PipelineResult {
  let current = doc
  const steps: StepStat[] = []

  for (const op of ops) {
    const inLines = current.lines.length
    const started = performance.now()
    try {
      const next = applyOp(current, op)
      steps.push({ op, inLines, outLines: next.lines.length, ms: performance.now() - started })
      current = next
    } catch (e) {
      steps.push({
        op,
        inLines,
        outLines: inLines,
        ms: performance.now() - started,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return { doc: current, steps }
}

/** Detect lines that are distinct only because of Unicode normalization form. */
export function findNormalizationCollisions(lines: readonly string[]): number {
  const byNfc = new Map<string, Set<string>>()
  for (const line of lines) {
    const k = line.normalize('NFC')
    const set = byNfc.get(k) ?? new Set<string>()
    set.add(line)
    byNfc.set(k, set)
  }
  let collisions = 0
  for (const set of byNfc.values()) {
    if (set.size > 1) collisions += set.size
  }
  return collisions
}
