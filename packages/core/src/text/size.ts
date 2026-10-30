/**
 * Cheap measurements of pasted text, for deciding how much work to do on it.
 * Both run in one pass without allocating, so they are safe on the keystroke.
 */

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

/**
 * Past this many characters on one line, an input should stop soft-wrapping.
 *
 * Chrome re-lays out a whole paragraph on every edit, and a soft-wrapped
 * paragraph of a few MB takes seconds: measured on a 3 MB single-line paste,
 * 2.2-8 s from keystroke to paint, against 0.2-0.8 s with `wrap="off"` and
 * ~0.1 s for the same 3 MB in 100-character lines. Below ~100k characters
 * wrapping costs little, and wrapped text is easier to read.
 */
export const NO_WRAP_LINE = 100_000

/**
 * Whether any line is longer than `limit`. One `indexOf` per line, so it is
 * cheap enough to run on the keystroke itself, which lets a paste lay out
 * unwrapped the first time rather than paying for a wrapped layout once.
 */
export function hasLongLine(text: string, limit = NO_WRAP_LINE): boolean {
  if (text.length <= limit) return false
  let start = 0
  for (;;) {
    const nl = text.indexOf('\n', start)
    const end = nl < 0 ? text.length : nl
    if (end - start > limit) return true
    if (nl < 0) return false
    start = nl + 1
  }
}
