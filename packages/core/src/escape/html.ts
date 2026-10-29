import { decodeEntities } from '../html-text/entities.ts'
import { ok, type EscapeResult } from './result.ts'

const OUT: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  // &#39; rather than &apos;, which HTML 4 and old IE never knew.
  "'": '&#39;',
}

/** Safe in element text and in both single- and double-quoted attribute values. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => OUT[c]!)
}

const REF = /&(?:#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g

/**
 * Decode named, decimal and hex character references in one pass, so
 * `&amp;lt;` becomes `&lt;`, not `<`. Decoding is html-text's (a partial
 * named table, plus the windows-1252 remap of `&#150;` that browsers apply);
 * this adds the warnings, so a reference left undecoded is never silent.
 */
export function unescapeHtml(input: string): EscapeResult {
  return ok(decodeEntities(input), input.includes('&') ? refWarnings(input) : [])
}

function refWarnings(input: string): string[] {
  let unknown: { ref: string; at: number } | undefined
  let unknownCount = 0
  let invalid: { ref: string; at: number } | undefined
  let invalidCount = 0
  for (const m of input.matchAll(REF)) {
    const ref = m[0]
    const decoded = decodeEntities(ref)
    if (decoded === ref) {
      unknown ??= { ref, at: m.index }
      unknownCount++
    } else if (decoded === '\uFFFD' && !/^&#(?:65533|[xX]0*[fF][fF][fF][dD]);$/.test(ref)) {
      invalid ??= { ref, at: m.index }
      invalidCount++
    }
  }
  const warnings: string[] = []
  if (unknown !== undefined) {
    warnings.push(
      `${unknown.ref} at position ${unknown.at + 1} is not an entity this tool knows, so it was left as is` +
        (unknownCount > 1 ? ` (${unknownCount} in total).` : '.'),
    )
  }
  if (invalid !== undefined) {
    warnings.push(
      `${invalid.ref} at position ${invalid.at + 1} is not a valid character, so it became U+FFFD, as a browser does` +
        (invalidCount > 1 ? ` (${invalidCount} in total).` : '.'),
    )
  }
  return warnings
}
