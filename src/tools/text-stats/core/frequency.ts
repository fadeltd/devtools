import { wordTokens } from './stats'

export interface Phrase {
  phrase: string
  count: number
  /** Share of all n-gram occurrences, 0..1. */
  density: number
}

export interface FrequencyOptions {
  /** 1 = single words, 2 = pairs, 3 = triples. */
  size: 1 | 2 | 3
  caseSensitive: boolean
  /** Drop very common function words. Only meaningful for size 1. */
  ignoreStopWords: boolean
  /** Drop tokens shorter than this many characters. */
  minLength: number
  limit: number
  locale?: string
}

/**
 * English function words. Deliberately short and conservative: an aggressive
 * list silently hides real results, and this is a counting tool, not a search
 * engine. It is also why stop words are opt-in rather than on by default.
 */
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'for',
  'of', 'to', 'in', 'on', 'at', 'by', 'from', 'with', 'about', 'as',
  'into', 'over', 'after', 'before', 'between', 'through', 'during',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'have', 'has', 'had', 'having',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
  'not', 'no', 'if', 'then', 'than', 'there', 'here', 'when', 'where', 'which',
  'who', 'whom', 'what', 'why', 'how', 'all', 'any', 'both', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very',
  's', 't', 'just', 'now',
])

/**
 * Keyword density over n-grams.
 *
 * Density is the share of total n-gram occurrences, not of raw character
 * count, so the numbers for a given n sum to 100%. Note that filtering (stop
 * words, minimum length) happens BEFORE the total is computed, so densities
 * stay comparable within the filtered set rather than silently summing to less
 * than 100%.
 */
export function wordFrequencies(text: string, options: FrequencyOptions): Phrase[] {
  const { size, caseSensitive, ignoreStopWords, minLength, limit, locale } = options

  const raw = wordTokens(text, locale)
  const normalized = raw.map((t) => (caseSensitive ? t : t.toLowerCase()))

  const keep = (token: string) => {
    if ([...token].length < minLength) return false
    if (ignoreStopWords && STOP_WORDS.has(token.toLowerCase())) return false
    return true
  }

  const counts = new Map<string, number>()
  let total = 0

  if (size === 1) {
    for (const token of normalized) {
      if (!keep(token)) continue
      counts.set(token, (counts.get(token) ?? 0) + 1)
      total++
    }
  } else {
    // For phrases, filter the token stream first, then window over what is
    // left -- otherwise every phrase would be padded with stop words.
    const filtered = normalized.filter(keep)
    for (let i = 0; i + size <= filtered.length; i++) {
      const phrase = filtered.slice(i, i + size).join(' ')
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1)
      total++
    }
  }

  if (total === 0) return []

  return [...counts.entries()]
    .map(([phrase, count]) => ({ phrase, count, density: count / total }))
    .toSorted((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase))
    .slice(0, limit)
}
