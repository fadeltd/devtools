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

/**
 * UTF-8 byte length without encoding anything.
 *
 * `new Blob([text]).size` and `TextEncoder` both materialise the bytes -- a
 * 20 MB copy on every call. Here every UTF-16 code unit starts at one byte and
 * only runs of non-ASCII are visited, found by a regex so the ASCII stretches
 * are skipped natively: ~14 ms on 20 MB of ASCII, against ~47 ms for a
 * charCodeAt loop over all of it. A lone surrogate counts 3 bytes, because that
 * is what the encoder replaces it with (U+FFFD).
 */
export function utf8Length(text: string): number {
  let bytes = text.length
  const re = /[\u0080-\uffff]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const run = m[0]
    for (let i = 0; i < run.length; i++) {
      const c = run.charCodeAt(i)
      if (c < 0x800) {
        bytes += 1 // 2 bytes
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < run.length) {
        const next = run.charCodeAt(i + 1)
        // A pair is 2 units and 4 bytes; a lone high surrogate is 1 unit and 3 bytes.
        if (next >= 0xdc00 && next <= 0xdfff) i++
        bytes += 2
      } else {
        bytes += 2 // 3 bytes, including a lone surrogate
      }
    }
  }
  return bytes
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
      reason: `Large input (${megabytes(bytes)}): auto-fixes and embedded-JSON expansion are off.`,
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
