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
