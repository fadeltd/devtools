/**
 * How much of a file the UI is allowed to touch.
 *
 * - inline: the encoded text goes into the output textarea, like text mode.
 * - large: encoded off the main thread and copyable/downloadable, but only a
 *   head of it is ever put in the DOM -- a 33 MB string in a textarea freezes
 *   layout and makes select-all unusable.
 * - refuse: rejected before a single byte is read.
 */
export type FileTier = 'inline' | 'large' | 'refuse'

export const INLINE_MAX_BYTES = 1024 * 1024
export const FILE_MAX_BYTES = 25 * 1024 * 1024

export function fileTier(bytes: number): FileTier {
  if (bytes > FILE_MAX_BYTES) return 'refuse'
  if (bytes > INLINE_MAX_BYTES) return 'large'
  return 'inline'
}

export const HEAD_CHARS = 2048

/** The first `maxChars` of `text`, plus how many characters were left out. */
export function headOf(text: string, maxChars = HEAD_CHARS): { head: string; omitted: number } {
  if (text.length <= maxChars) return { head: text, omitted: 0 }
  return { head: text.slice(0, maxChars), omitted: text.length - maxChars }
}
