export interface InputNotes {
  /** Number of `\r\n` pairs. Windows editors and some clipboards add them. */
  crlf: number
  /**
   * Newlines (`\n` or `\r\n`) at the very end. `echo` adds one and `printf`
   * does not, which is the usual reason a hash "doesn't match".
   */
  trailingNewlines: number
  /**
   * Unpaired UTF-16 surrogates. TextEncoder silently replaces each with
   * U+FFFD, so the bytes hashed are not the text shown.
   */
  loneSurrogates: boolean
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/**
 * What about this text would surprise someone comparing its hash. Reports
 * only: the engine never rewrites a message, because a signature is over
 * exact bytes and any normalising would make it wrong.
 */
export function inspectInput(text: string): InputNotes {
  let crlf = 0
  for (let i = text.indexOf('\r\n'); i !== -1; i = text.indexOf('\r\n', i + 2)) crlf++

  let trailingNewlines = 0
  let end = text.length
  while (end > 0 && text[end - 1] === '\n') {
    trailingNewlines++
    end -= text[end - 2] === '\r' ? 2 : 1
  }

  return { crlf, trailingNewlines, loneSurrogates: LONE_SURROGATE.test(text) }
}

/** Remove exactly one final `\n` or `\r\n`: the one `echo` added. */
export function stripTrailingNewline(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2)
  if (text.endsWith('\n')) return text.slice(0, -1)
  return text
}
