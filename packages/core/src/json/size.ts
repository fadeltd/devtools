/**
 * Size guardrails for the JSON tool, so a 20 MB paste degrades visibly instead
 * of hanging the tab.
 *
 * Measured on 20 MB of NDJSON (141k records, Node 24 / V8): `analyze` ~145 ms,
 * the number scan ~30 ms, formatting ~60 ms -- all tolerable once. What is not
 * is everything built for small documents: the auto-fix pipeline tokenises the
 * whole text four times (~1.5 s), the embedded-JSON scan walks every string
 * (~120 ms, then expansion clones the tree), lossless re-parsing calls a
 * reviver per value (~620 ms with many big integers), and a 32 MB formatted
 * string in a textarea freezes layout.
 */

import { utf8Length } from '../text/size.ts'

/** Above this, the `large` tier: validation and formatting only. */
export const JSON_LARGE_BYTES = 1024 * 1024
/** Above this, the `refuse` tier: nothing is parsed at all. */
export const JSON_REFUSE_BYTES = 50 * 1024 * 1024

export type JsonSizeTier = 'ok' | 'large' | 'refuse'

export interface JsonSizeVerdict {
  tier: JsonSizeTier
  /** UTF-8 byte length of the input. */
  bytes: number
  /** Why the tool is doing less than usual; null in the `ok` tier. */
  reason: string | null
}


function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Which tier a byte length falls in, with the sentence to show the user. */
export function jsonSizeTier(bytes: number): JsonSizeVerdict {
  if (bytes > JSON_REFUSE_BYTES) {
    return {
      tier: 'refuse',
      bytes,
      reason: `This input is ${megabytes(bytes)}, over the ${megabytes(JSON_REFUSE_BYTES)} limit, so it is not parsed. Use jq on the command line.`,
    }
  }
  if (bytes > JSON_LARGE_BYTES) {
    return {
      tier: 'large',
      bytes,
      reason: `Large input (${megabytes(bytes)}): auto-fixes and embedded-JSON expansion are off, and editing may feel slow. Past ${megabytes(JSON_REFUSE_BYTES)} nothing is parsed.`,
    }
  }
  return { tier: 'ok', bytes, reason: null }
}

/** Measure `text` and place it in a tier. One pass, no allocation. */
export function assessJsonSize(text: string): JsonSizeVerdict {
  return jsonSizeTier(utf8Length(text))
}

/**
 * The start of a long output, cut at a line break where one is near, plus how
 * many characters were left out. The full text still goes to Copy and
 * Download; only this much is ever put in the DOM.
 */
export function outputHead(text: string, maxChars: number): { head: string; omitted: number } {
  if (text.length <= maxChars) return { head: text, omitted: 0 }
  const nl = text.lastIndexOf('\n', maxChars)
  // Only back up to a line break if it does not throw most of the head away.
  const end = nl > maxChars / 2 ? nl : maxChars
  return { head: text.slice(0, end), omitted: text.length - end }
}
