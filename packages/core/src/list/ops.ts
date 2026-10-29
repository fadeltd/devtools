import type { CaseTarget, Op } from './types.ts'

export type OpKind = Op['kind']

/** Display order of the "+ Add operation" menu: most-reached-for first. */
export const OP_KINDS = [
  'sort',
  'dedupe',
  'filter',
  'case',
  'affix',
  'trim',
  'number',
  'join',
  'split',
  'wrap',
  'slice',
  'setop',
  'normalize',
  'reverse',
  'shuffle',
] as const satisfies readonly OpKind[]

export const OP_LABELS: Record<OpKind, string> = {
  sort: 'Sort',
  dedupe: 'Remove duplicates',
  filter: 'Filter lines',
  case: 'Change case',
  affix: 'Prefix / suffix',
  trim: 'Trim whitespace',
  number: 'Number lines',
  join: 'Join lines',
  split: 'Split lines',
  wrap: 'Wrap to width',
  slice: 'Keep a range',
  setop: 'Compare with a list',
  normalize: 'Unicode normalize',
  reverse: 'Reverse',
  shuffle: 'Randomize',
}

export function isOpKind(v: string): v is OpKind {
  return Object.hasOwn(OP_LABELS, v)
}

/** A sensible starting point for each kind -- every one is a valid, runnable op. */
export function defaultOp(kind: OpKind): Op {
  switch (kind) {
    case 'sort':
      return { kind, order: 'asc', mode: 'natural', caseSensitive: false, blanks: 'keep' }
    case 'dedupe':
      return { kind, caseSensitive: false, trimKey: false, keep: 'first', output: 'unique' }
    case 'shuffle':
      return { kind, source: 'crypto' }
    case 'reverse':
      return { kind }
    case 'case':
      return { kind, target: 'lower' }
    case 'affix':
      return { kind, prefix: '', suffix: '', skipBlank: true }
    case 'filter':
      return { kind, action: 'keep', test: { t: 'contains', needle: '', ci: true } }
    case 'number':
      return {
        kind,
        start: 1,
        step: 1,
        pad: 0,
        padChar: '0',
        separator: '. ',
        position: 'prefix',
        skipBlank: false,
      }
    case 'wrap':
      return { kind, width: 80, breakWords: false, preserveIndent: true }
    case 'join':
      return { kind, separator: ', ' }
    case 'split':
      return { kind, by: { t: 'literal', s: ',' } }
    case 'trim':
      return { kind, leading: true, trailing: true, collapseInternal: false }
    case 'normalize':
      return { kind, form: 'NFC' }
    case 'setop':
      return { kind, op: 'intersection', other: '', caseSensitive: true, bag: false }
    case 'slice':
      return { kind, from: 0, to: 10 }
  }
}

export const CASE_LABELS: Record<CaseTarget, string> = {
  upper: 'UPPER CASE',
  lower: 'lower case',
  capitalize: 'Capitalize first',
  title: 'Title Case',
  sentence: 'Sentence case',
  camel: 'camelCase',
  pascal: 'PascalCase',
  snake: 'snake_case',
  kebab: 'kebab-case',
  constant: 'CONSTANT_CASE',
  dot: 'dot.case',
  path: 'path/case',
  train: 'Train-Case',
}

const SETOP_LABELS = {
  union: 'Union with',
  intersection: 'Only lines also in',
  difference: 'Lines not in',
  'symmetric-difference': 'Lines in exactly one of',
} as const

/** Quote a user value so leading/trailing spaces and empty strings are visible. */
function q(s: string): string {
  return JSON.stringify(s)
}

/** One line describing what a step does, for a collapsed card. */
export function summarizeOp(op: Op): string {
  switch (op.kind) {
    case 'sort':
      if (op.mode === 'random') return 'Random order'
      return `${{ natural: 'Natural', locale: 'Alphabetical', codepoint: 'Codepoint', length: 'By length' }[op.mode]}, ${op.order === 'asc' ? 'ascending' : 'descending'}`
    case 'dedupe':
      return {
        unique: `Keep ${op.keep} of each`,
        'duplicates-only': 'Only lines that repeat',
        'unique-only': 'Only lines that never repeat',
        'with-counts': 'Prefix each with its count',
      }[op.output]
    case 'shuffle':
      return 'Unbiased crypto shuffle'
    case 'reverse':
      return 'Last line first'
    case 'case':
      return CASE_LABELS[op.target]
    case 'affix':
      if (op.prefix === '' && op.suffix === '') return 'Nothing yet'
      return [op.prefix && `Prefix ${q(op.prefix)}`, op.suffix && `suffix ${q(op.suffix)}`]
        .filter(Boolean)
        .join(', ')
    case 'filter': {
      const verb = op.action === 'keep' ? 'Keep' : 'Remove'
      const t = op.test
      switch (t.t) {
        case 'contains':
          return `${verb} lines containing ${q(t.needle)}`
        case 'regex':
          return `${verb} lines matching /${t.source}/${t.flags}`
        case 'blank':
          return `${verb} blank lines`
        case 'index':
          return `${verb} lines ${t.ranges || '(none)'}`
        case 'duplicate':
          return `${verb} repeated lines`
      }
    }
    case 'number':
      return `${op.start}, ${op.start + op.step}, … as ${op.position}`
    case 'wrap':
      return `At ${op.width} columns`
    case 'join':
      return op.chunkSize
        ? `Every ${op.chunkSize} lines with ${q(op.separator)}`
        : `Into one line with ${q(op.separator)}`
    case 'split':
      return op.by.t === 'literal' ? `On ${q(op.by.s)}` : `On /${op.by.source}/${op.by.flags}`
    case 'trim':
      return (
        [op.leading && 'leading', op.trailing && 'trailing', op.collapseInternal && 'inner runs']
          .filter(Boolean)
          .join(', ') || 'Nothing selected'
      )
    case 'normalize':
      return op.form
    case 'setop':
      return `${SETOP_LABELS[op.op]} the other list`
    case 'slice':
      return op.to === undefined ? `From line ${op.from + 1}` : `Lines ${op.from + 1}–${op.to}`
  }
}

/** Move one item, keeping the rest in order. Out-of-range is a no-op. */
export function moveStep<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items]
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out
  const [item] = out.splice(from, 1)
  out.splice(to, 0, item!)
  return out
}

/**
 * Steps after which lines that differ only by Unicode form are worth flagging:
 * the ones that decide "same line or not". Dedupe normalises its key, so these
 * are exactly where an NFC/NFD pair silently survives or vanishes.
 */
export function appliesNormalizationCheck(op: Op): boolean {
  return (
    op.kind === 'dedupe' ||
    op.kind === 'setop' ||
    (op.kind === 'filter' && op.test.t === 'duplicate')
  )
}

export interface Step {
  id: string
  op: Op
  enabled: boolean
}

/**
 * `/list/sort`, `/list/dedupe`, ... deep-link to an operation. A saved
 * single-step pipeline is swapped to that kind so bookmarks still behave like
 * separate pages; a real chain is never clobbered by a link.
 */
export function withRouteKind(steps: readonly Step[], kind: OpKind | undefined): readonly Step[] {
  if (kind === undefined || steps.length > 1) return steps
  if (steps[0]?.op.kind === kind) return steps
  return [{ id: steps[0]?.id ?? 'route', op: defaultOp(kind), enabled: true }]
}
