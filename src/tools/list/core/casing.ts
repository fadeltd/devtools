import {
  camelCase,
  constantCase,
  dotCase,
  kebabCase,
  pascalCase,
  pathCase,
  snakeCase,
  trainCase,
} from 'change-case'
import type { CaseTarget } from './types'

/**
 * Words that stay lowercase inside a title unless they are first or last.
 * Correct title case is editorial, not algorithmic, so this is a pragmatic
 * default rather than a claim of correctness -- and it is why change-case has
 * no titleCase export to borrow.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet',
  'as', 'at', 'by', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via',
  'from', 'into', 'onto', 'over', 'with',
])

function upperFirst(word: string, locale?: string): string {
  if (word === '') return word
  const first = [...word][0]!
  const rest = word.slice(first.length)
  return (locale ? first.toLocaleUpperCase(locale) : first.toUpperCase()) + rest
}

export function toTitleCase(s: string, locale?: string): string {
  // Split on whitespace but keep it, so runs of spaces survive unchanged.
  const parts = s.split(/(\s+)/)
  const wordIndices = parts
    .map((p, i) => (/\S/.test(p) ? i : -1))
    .filter((i) => i >= 0)
  const first = wordIndices[0]
  const last = wordIndices[wordIndices.length - 1]

  return parts
    .map((part, i) => {
      if (!/\S/.test(part)) return part
      const lower = locale ? part.toLocaleLowerCase(locale) : part.toLowerCase()
      if (i !== first && i !== last && STOP_WORDS.has(lower)) return lower
      return upperFirst(lower, locale)
    })
    .join('')
}

export function toSentenceCase(s: string, locale?: string): string {
  const lower = locale ? s.toLocaleLowerCase(locale) : s.toLowerCase()
  const idx = lower.search(/\S/)
  if (idx === -1) return lower
  return lower.slice(0, idx) + upperFirst(lower.slice(idx), locale)
}

/**
 * Note: change-case splits acronyms, so `XMLHttpRequest` becomes
 * `xml-http-request`. That is usually what you want when generating ids.
 */
export function applyCase(s: string, target: CaseTarget, locale?: string): string {
  switch (target) {
    case 'upper':
      return locale ? s.toLocaleUpperCase(locale) : s.toUpperCase()
    case 'lower':
      return locale ? s.toLocaleLowerCase(locale) : s.toLowerCase()
    case 'capitalize':
      return upperFirst(s, locale)
    case 'title':
      return toTitleCase(s, locale)
    case 'sentence':
      return toSentenceCase(s, locale)
    case 'camel':
      return camelCase(s)
    case 'pascal':
      return pascalCase(s)
    case 'snake':
      return snakeCase(s)
    case 'kebab':
      return kebabCase(s)
    case 'constant':
      return constantCase(s)
    case 'dot':
      return dotCase(s)
    case 'path':
      return pathCase(s)
    case 'train':
      return trainCase(s)
  }
}
