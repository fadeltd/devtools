import { buildIndex } from './inspect.ts'
import { FLAG_BIT } from './tables.ts'

export type NormalizationForm = 'none' | 'NFC' | 'NFKC'

export interface CleanOptions {
  /** Remove zero-width characters, soft hyphens, BOMs and fillers. Default true. */
  invisible?: boolean
  /** Remove bidi controls (the Trojan Source class). Default true. */
  bidi?: boolean
  /** Remove tag characters outside a subdivision flag emoji. Default true. */
  tags?: boolean
  /** Replace NBSP, thin, ideographic and other exotic spaces with U+0020. Default true. */
  spaces?: boolean
  /** Applied last, after removal. Default 'none'. */
  normalize?: NormalizationForm
}

export interface CleanResult {
  text: string
  changed: boolean
  removed: { invisible: number; bidi: number; tag: number }
  spacesReplaced: number
  /** True when normalisation changed the text beyond the removals. */
  normalized: boolean
}

/**
 * Strips the characters that silently break parsers and comparisons, and
 * nothing else: controls, variation selectors, private use and lone surrogates
 * are reported by the inspector but left alone, because removing them changes
 * meaning rather than restoring it.
 *
 * Built on the same index as the inspector, so an emoji's ZWJ or a subdivision
 * flag's tags survive -- clean() never turns 👨‍👩‍👧 into 👨👩👧.
 */
export function clean(text: string, opts: CleanOptions = {}): CleanResult {
  const invisible = opts.invisible ?? true
  const bidi = opts.bidi ?? true
  const tags = opts.tags ?? true
  const spaces = opts.spaces ?? true
  const form = opts.normalize ?? 'none'

  const removeMask =
    (invisible ? FLAG_BIT.invisible : 0) | (bidi ? FLAG_BIT.bidi : 0) | (tags ? FLAG_BIT.tag : 0)
  const removed = { invisible: 0, bidi: 0, tag: 0 }
  let spacesReplaced = 0

  const index = buildIndex(text)
  const parts: string[] = []
  let last = 0
  for (let i = 0; i < index.flagged.length; i++) {
    const mask = index.masks[i]!
    const cpIndex = index.flagged[i]!
    const start = index.offsets[cpIndex]!
    const end = index.offsets[cpIndex + 1]!
    if ((mask & removeMask) !== 0) {
      parts.push(text.slice(last, start))
      last = end
      if ((mask & FLAG_BIT.invisible) !== 0) removed.invisible++
      else if ((mask & FLAG_BIT.bidi) !== 0) removed.bidi++
      else removed.tag++
    } else if (spaces && (mask & FLAG_BIT.space) !== 0) {
      parts.push(text.slice(last, start), ' ')
      last = end
      spacesReplaced++
    }
  }

  let out = last === 0 ? text : parts.join('') + text.slice(last)
  let normalized = false
  if (form !== 'none') {
    const next = out.normalize(form)
    normalized = next !== out
    out = next
  }

  return { text: out, changed: out !== text, removed, spacesReplaced, normalized }
}
