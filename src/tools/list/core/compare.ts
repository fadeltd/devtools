import type { Op } from './types'

type SortOp = Extract<Op, { kind: 'sort' }>

/**
 * Collators are expensive to construct and cheap to reuse, so they are cached
 * and `.compare` is extracted once.
 *
 * This is the single most important line in the tool: calling
 * `a.localeCompare(b, undefined, { numeric: true })` per comparison measures
 * ~9.7s on 100k lines, versus ~806ms with a hoisted collator. Same result, 12x.
 */
const collatorCache = new Map<string, (a: string, b: string) => number>()

function collator(locale: string | undefined, numeric: boolean, caseSensitive: boolean) {
  const key = `${locale ?? ''}|${numeric}|${caseSensitive}`
  let cmp = collatorCache.get(key)
  if (!cmp) {
    cmp = new Intl.Collator(locale, {
      numeric,
      sensitivity: caseSensitive ? 'variant' : 'accent',
    }).compare
    collatorCache.set(key, cmp)
  }
  return cmp
}

/**
 * Build a comparator for a sort op. `random` is handled by shuffle.ts, not here.
 *
 * There is deliberately no separate "version" mode. Intl numeric collation
 * already compares digit runs segment by segment, so `1.10` correctly sorts
 * after `1.9` -- it does NOT read `1.10` as a decimal (verified). A hand-rolled
 * version comparator would also be strictly worse, because parsing each digit
 * run with Number() loses precision beyond 16 digits, while Intl compares the
 * digit strings exactly.
 */
export function comparatorFor(op: SortOp): (a: string, b: string) => number {
  switch (op.mode) {
    case 'codepoint': {
      if (op.caseSensitive) return (a, b) => (a < b ? -1 : a > b ? 1 : 0)
      return (a, b) => {
        const x = a.toLowerCase()
        const y = b.toLowerCase()
        return x < y ? -1 : x > y ? 1 : 0
      }
    }
    case 'locale':
      return collator(op.locale, false, op.caseSensitive)
    case 'natural':
      return collator(op.locale, true, op.caseSensitive)
    case 'length':
      return (a, b) => a.length - b.length
    case 'random':
      return () => 0
  }
}
