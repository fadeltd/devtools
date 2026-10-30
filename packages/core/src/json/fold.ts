/** An object or array body that spans more than one line. */
export interface FoldRange {
  /** Just after the opening `{` or `[`. */
  from: number
  /** At the closing `}` or `]`. */
  to: number
  /** 0 for the root container, 1 for its members, and so on. */
  depth: number
}

const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d
const QUOTE = 0x22
const BACKSLASH = 0x5c
const NEWLINE = 0x0a

/**
 * Every multi-line object and array in a JSON text, ordered by `from`, with
 * the same bounds an editor's JSON fold uses (inside the brackets).
 *
 * A single linear scan that only tracks strings and brackets, so it costs a
 * few milliseconds on a megabyte where building a full syntax tree costs most
 * of a second. Meant for formatted output: it does not validate, and a
 * mismatched bracket is skipped rather than reported.
 */
export function foldRanges(text: string, { minDepth = 0 }: { minDepth?: number } = {}): FoldRange[] {
  const ranges: Array<FoldRange | null> = []
  // Per open container: its slot in `ranges`, its closing char, the offset of
  // its opening bracket.
  const stack: Array<{ slot: number; close: number; open: number }> = []
  let lastNewline = -1

  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === QUOTE) {
      i = endOfString(text, i)
    } else if (c === NEWLINE) {
      lastNewline = i
    } else if (c === OPEN_BRACE || c === OPEN_BRACKET) {
      stack.push({ slot: ranges.length, close: c === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET, open: i })
      ranges.push(null)
    } else if (c === CLOSE_BRACE || c === CLOSE_BRACKET) {
      const top = stack[stack.length - 1]
      if (top === undefined || top.close !== c) continue
      stack.pop()
      const depth = stack.length
      if (lastNewline > top.open && depth >= minDepth) ranges[top.slot] = { from: top.open + 1, to: i, depth }
    }
  }

  return ranges.filter((r): r is FoldRange => r !== null)
}

/** The offset of the quote closing the string opened at `start`, or the end. */
function endOfString(text: string, start: number): number {
  let i = start + 1
  for (;;) {
    const q = text.indexOf('"', i)
    if (q === -1) return text.length
    let slashes = 0
    while (text.charCodeAt(q - 1 - slashes) === BACKSLASH) slashes++
    if (slashes % 2 === 0) return q
    i = q + 1
  }
}
