import type { ByteFormat, HexPrefix, InputFormat, Separator } from '@fadeltd/devtools-core/text-bytes'

export type Direction = 'encode' | 'decode'
export type Fallback = 'replacement' | 'latin1'

/** The tool's state, which is also exactly what the worker needs. */
export interface TextBytesInput {
  input: string
  direction: Direction
  /** Kept apart from decodeFormat so 'auto' never leaks into the encoder. */
  format: ByteFormat
  decodeFormat: InputFormat
  separator: Separator
  uppercase: boolean
  prefix: HexPrefix
  perLine: number
  fallback: Fallback
}

export interface Note {
  tone: 'neutral' | 'warn'
  text: string
}

export interface Outcome {
  output: string
  /** Shown in the output pane in place of the output: the input cannot be read. */
  error: string | null
  /** Set when the output is a stand-in for text that does not exist. */
  fallback: { label: string; problem: string } | null
  stats: string | null
  notes: Note[]
  /** The format bytes were read as, for Swap. */
  format: ByteFormat | null
}

export const FORMAT_LABELS: Record<ByteFormat, string> = {
  binary: 'Binary',
  hex: 'Hex',
  decimal: 'Decimal',
  octal: 'Octal',
}

/**
 * Past this many characters on one line, the input stops soft-wrapping.
 *
 * Chrome re-lays out a whole paragraph on every edit, and a soft-wrapped
 * paragraph of a few MB takes seconds: measured on a 3 MB single-line paste,
 * 2.2–8 s from keystroke to paint, against 0.2–0.8 s with `wrap="off"` and
 * ~0.1 s for the same 3 MB in 100-character lines. Below ~100k characters
 * wrapping costs little, and wrapped text is easier to read.
 */
export const NO_WRAP_LINE = 100_000

/**
 * Whether any line is longer than `limit`. One `indexOf` per line, so it is
 * cheap enough to run on the keystroke itself, which lets a paste lay out
 * unwrapped the first time rather than paying for a wrapped layout once.
 */
export function hasLongLine(text: string, limit: number): boolean {
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
