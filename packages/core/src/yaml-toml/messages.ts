import { buildLineIndex, lineText, offsetToLineCol, visualColumn, type LineIndex } from '../text/offsets.ts'
import type { JsonIssue } from '../json/errors.ts'

export interface Snippet {
  lines: Array<{ number: number; text: string }>
  caretLine: number
  /** 1-based and tab-expanded, so a monospace caret lands under the character. */
  caretColumn: number
}

/**
 * One error, warning or note. Everything the converter has to say comes back as
 * one of these -- nothing throws -- so the UI can list it under the output.
 */
export interface Message {
  code: string
  message: string
  hint: string | null
  /** jq-style path of the value concerned (`.servers[0].host`), when there is one. */
  path: string | null
  /** 1-based; null when the problem has no place in the input (e.g. a TOML document's root). */
  line: number | null
  column: number | null
  snippet: Snippet | null
}

const CONTEXT_LINES = 2
/** Characters of a long line shown around the caret. */
const SNIPPET_WIDTH = 120

/**
 * Lazily indexes the input once, so every message that needs a position shares
 * one pass over a possibly large document -- and inputs with no messages pay
 * nothing.
 */
export class SourceText {
  readonly text: string
  readonly tabWidth: number
  #index: LineIndex | null = null

  constructor(text: string, tabWidth: number) {
    this.text = text
    this.tabWidth = tabWidth
  }

  get index(): LineIndex {
    this.#index ??= buildLineIndex(this.text)
    return this.#index
  }

  lineCol(offset: number): { line: number; column: number } {
    return offsetToLineCol(this.index, Math.max(0, Math.min(offset, this.text.length)))
  }

  /**
   * The same few-lines-of-context-plus-caret block the JSON tool shows.
   *
   * Long lines are cut to a window around the caret: an error in minified
   * JSON would otherwise put a megabyte-long line into the snippet.
   */
  snippet(line: number, column: number): Snippet {
    const index = this.index
    const caretText = lineText(this.text, index, line)
    const start =
      caretText.length > SNIPPET_WIDTH
        ? Math.max(0, Math.min(column - 1 - SNIPPET_WIDTH / 2, caretText.length - SNIPPET_WIDTH))
        : 0
    const clip = (s: string) =>
      start === 0 && s.length <= SNIPPET_WIDTH
        ? s
        : `${start > 0 ? '…' : ''}${s.slice(start, start + SNIPPET_WIDTH)}${s.length > start + SNIPPET_WIDTH ? '…' : ''}`

    const from = Math.max(1, line - CONTEXT_LINES)
    const to = Math.min(index.lineCount, line + CONTEXT_LINES)
    const lines: Snippet['lines'] = []
    for (let n = from; n <= to; n++) {
      lines.push({ number: n, text: clip(lineText(this.text, index, n)) })
    }
    return {
      lines,
      caretLine: line,
      // The leading ellipsis takes one column of its own.
      caretColumn: visualColumn(clip(caretText), column - start + (start > 0 ? 1 : 0), this.tabWidth),
    }
  }

  at(line: number, column: number): Pick<Message, 'line' | 'column' | 'snippet'> {
    return { line, column, snippet: this.snippet(line, column) }
  }

  atOffset(offset: number): Pick<Message, 'line' | 'column' | 'snippet'> {
    const { line, column } = this.lineCol(offset)
    return this.at(line, column)
  }
}

export function message(
  code: string,
  text: string,
  extra: Partial<Omit<Message, 'code' | 'message'>> = {},
): Message {
  return {
    code,
    message: text,
    hint: extra.hint ?? null,
    path: extra.path ?? null,
    line: extra.line ?? null,
    column: extra.column ?? null,
    snippet: extra.snippet ?? null,
  }
}

/**
 * The JSON tool's issues carry the message, hint and position; the snippet is
 * redrawn here so long lines are windowed like every other format's.
 */
export function fromJsonIssue(issue: JsonIssue, src: SourceText): Message {
  return {
    code: `json-${issue.code}`,
    message: issue.message,
    hint: issue.hint,
    path: null,
    ...src.at(issue.line, issue.column),
  }
}
