/**
 * Tokenizers for the two-stage diff.
 *
 * Both are lossless -- joining the tokens gives back the input exactly -- which
 * is what lets the engine turn token counts back into character offsets on each
 * side independently.
 */

/**
 * Split into lines, each keeping its terminator (`\n`, or `\r\n`, since the
 * `\r` simply precedes it). `""` has no lines, and `"a\nb\n"` has two, not
 * three: there is no phantom empty line after a final newline.
 */
export function splitLines(text: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

// A word (letters including combining marks, digits, underscore), a run of
// horizontal whitespace, one line break, or any other single code point.
const WORD_TOKEN = /[\p{L}\p{M}\p{N}_]+|[^\S\r\n]+|\r?\n|[\s\S]/gu

/** Split into tokens for intra-line highlighting. */
export function splitWords(text: string): string[] {
  return text.match(WORD_TOKEN) ?? []
}
