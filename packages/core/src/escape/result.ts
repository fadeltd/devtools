import { buildLineIndex, offsetToLineCol } from '../text/offsets.ts'

export interface EscapeError {
  /** 0-based UTF-16 index into the input, pointing at the offending character. */
  index: number
  /** 1-based. */
  line: number
  /** 1-based, in UTF-16 code units. */
  column: number
  message: string
}

/**
 * Bad input comes back as data, never as a throw: the tool renders the message
 * inline and keeps the last good state of everything else.
 */
export type EscapeResult =
  | { ok: true; output: string; warnings: string[] }
  | { ok: false; error: EscapeError }

export function ok(output: string, warnings: string[] = []): EscapeResult {
  return { ok: true, output, warnings }
}

/**
 * `what` names the problem, `hint` says how to fix it. The position is spelled
 * out in the message too, because on a pasted one-line blob "column 4,113" is
 * the only way to find it.
 */
export function fail(input: string, index: number, what: string, hint?: string): EscapeResult {
  const { line, column } = offsetToLineCol(buildLineIndex(input), index)
  const where = line > 1 ? `position ${index + 1} (line ${line}, column ${column})` : `position ${index + 1}`
  return {
    ok: false,
    error: { index, line, column, message: `${what} at ${where}${hint === undefined ? '' : `: ${hint}`}.` },
  }
}

export function hex(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, '0')
}

export function isHexDigit(c: string | undefined): boolean {
  return c !== undefined && /^[0-9a-fA-F]$/.test(c)
}

/** Describe a character for an error message, so an invisible one is still visible. */
export function show(c: string): string {
  const cp = c.codePointAt(0)!
  if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029) {
    return `U+${hex(cp, 4)}`
  }
  return c
}
