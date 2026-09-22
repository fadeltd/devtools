import type { LineDoc } from './types'

const BOM = '﻿'

/**
 * Split text into a LineDoc without losing or inventing anything.
 *
 * Guarantees (all covered by tests):
 *   ""        -> 0 lines
 *   "a"       -> 1 line,  trailingNewline: false
 *   "a\n"     -> 1 line,  trailingNewline: true
 *   "a\nb\n"  -> 2 lines, trailingNewline: true   (never a phantom 3rd line)
 *   "\n"      -> 1 empty line, trailingNewline: true
 *
 * A lone \r is classic-Mac and still turns up in old exports, so it counts as a
 * terminator. Leaving a \r glued to a line end would silently break both dedupe
 * and sort, because "a\r" !== "a".
 */
export function parseLines(input: string): LineDoc {
  const bom = input.startsWith(BOM)
  const text = bom ? input.slice(BOM.length) : input

  if (text === '') {
    return { lines: [], eol: '\n', trailingNewline: false, bom }
  }

  let crlf = 0
  let lf = 0
  let cr = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\r') {
      if (text[i + 1] === '\n') {
        crlf++
        i++
      } else {
        cr++
      }
    } else if (ch === '\n') {
      lf++
    }
  }

  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length
  const eol: LineDoc['eol'] =
    kinds > 1 ? 'mixed' : crlf > 0 ? '\r\n' : cr > 0 ? '\r' : '\n'

  const lines = text.split(/\r\n|\r|\n/)
  // A terminator at the very end yields a final "" element that is not a line.
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === ''
  if (trailingNewline) lines.pop()

  return { lines, eol, trailingNewline, bom }
}

/**
 * Inverse of parseLines.
 *
 * `serializeLines(parseLines(t)) === t` holds exactly for any input with a
 * uniform line ending (LF, CRLF, or lone CR). For `eol: 'mixed'` there is no
 * single faithful answer, so we normalize to LF -- which is why the UI raises a
 * visible "mixed line endings" chip instead of silently picking for you.
 */
export function serializeLines(doc: LineDoc, eolOverride?: '\n' | '\r\n'): string {
  const sep = eolOverride ?? (doc.eol === 'mixed' ? '\n' : doc.eol)
  const body = doc.lines.join(sep)
  const tail = doc.trailingNewline ? sep : ''
  return (doc.bom ? BOM : '') + body + tail
}

/** Replace the lines of a doc, preserving its eol/bom/trailing-newline facts. */
export function withLines(doc: LineDoc, lines: string[]): LineDoc {
  return { ...doc, lines }
}

export function isBlank(line: string): boolean {
  return line.trim() === ''
}
