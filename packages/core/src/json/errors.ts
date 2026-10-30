import { visit, type ParseError } from 'jsonc-parser'
import { buildLineIndex, offsetToLineCol, visualColumn } from '../text/offsets.ts'

export interface JsonIssue {
  severity: 'error' | 'warning'
  code: string
  /** Human, imperative, and specific about what to do. */
  message: string
  hint: string | null
  offset: number
  length: number
  line: number
  column: number
  snippet: {
    lines: Array<{ number: number; text: string }>
    caretLine: number
    caretColumn: number
  }
}

export type Flavor = 'json' | 'jsonc' | 'ndjson' | 'invalid' | 'empty'

export interface Analysis {
  value?: unknown
  issues: JsonIssue[]
  flavor: Flavor
  /** Set when the input parses line-by-line, i.e. it is probably NDJSON. */
  ndjson: { records: number } | null
  /** True when there were more problems than the MAX_ISSUES reported in `issues`. */
  moreIssues: boolean
}

/**
 * At most this many issues are reported. Pasted prose yields one parser error
 * per word -- hundreds of thousands on a few MB -- and nobody reads past the
 * first screenful anyway.
 */
export const MAX_ISSUES = 100

/**
 * Snippet lines longer than this are cut to a window around the caret. A
 * minified document is one line, and a 20 MB line has no business in the DOM.
 */
export const SNIPPET_MAX_LINE = 240
const SNIPPET_WINDOW = 120

/**
 * Human messages for jsonc-parser's numeric codes.
 *
 * We report positions from jsonc-parser on every engine rather than scraping
 * the native error message, because V8, JavaScriptCore and SpiderMonkey all
 * word it differently and JavaScriptCore gives no position at all -- so
 * scraping silently degrades on Safari.
 */
/**
 * Mirror of jsonc-parser's ParseErrorCode, verified against its shipped
 * declarations. Declared locally because the upstream type is an ambient const
 * enum, which cannot be referenced under `verbatimModuleSyntax`.
 */
const Code = {
  InvalidSymbol: 1,
  InvalidNumberFormat: 2,
  PropertyNameExpected: 3,
  ValueExpected: 4,
  ColonExpected: 5,
  CommaExpected: 6,
  CloseBraceExpected: 7,
  CloseBracketExpected: 8,
  EndOfFileExpected: 9,
  InvalidCommentToken: 10,
  UnexpectedEndOfComment: 11,
  UnexpectedEndOfString: 12,
  UnexpectedEndOfNumber: 13,
  InvalidUnicode: 14,
  InvalidEscapeCharacter: 15,
  InvalidCharacter: 16,
} as const

const MESSAGES: Record<number, { code: string; message: string; hint?: string }> = {
  [Code.InvalidSymbol]: {
    code: 'invalid-symbol',
    message: 'Unexpected token',
    hint: 'Often an unquoted key or string value — JSON requires double quotes around both.',
  },
  [Code.InvalidNumberFormat]: {
    code: 'invalid-number',
    message: 'Invalid number',
    hint: 'JSON numbers cannot have a leading +, a leading zero, or a trailing dot.',
  },
  [Code.PropertyNameExpected]: {
    code: 'property-name-expected',
    message: 'Expected a property name in double quotes',
    hint: 'JSON requires keys to be quoted, and does not allow a trailing comma before }.',
  },
  [Code.ValueExpected]: {
    code: 'value-expected',
    message: 'Expected a value',
    hint: 'There is probably a trailing comma, or a key with nothing after its colon.',
  },
  [Code.ColonExpected]: {
    code: 'colon-expected',
    message: 'Expected a colon after the property name',
  },
  [Code.CommaExpected]: {
    code: 'comma-expected',
    message: 'Expected a comma between items',
  },
  [Code.CloseBraceExpected]: {
    code: 'close-brace-expected',
    message: 'Expected a closing }',
  },
  [Code.CloseBracketExpected]: {
    code: 'close-bracket-expected',
    message: 'Expected a closing ]',
  },
  [Code.EndOfFileExpected]: {
    code: 'end-of-file-expected',
    message: 'Unexpected content after the end of the JSON value',
    hint: 'If this is a log file with one object per line, it is NDJSON rather than JSON.',
  },
  [Code.InvalidCommentToken]: {
    code: 'invalid-comment',
    message: 'Comments are not allowed in strict JSON',
    hint: 'Enable lenient mode to accept comments and trailing commas.',
  },
  [Code.UnexpectedEndOfComment]: {
    code: 'unterminated-comment',
    message: 'Unterminated comment',
  },
  [Code.UnexpectedEndOfString]: {
    code: 'unterminated-string',
    message: 'Unterminated string',
    hint: 'A closing double quote is missing, or a newline appears inside the string.',
  },
  [Code.UnexpectedEndOfNumber]: {
    code: 'unterminated-number',
    message: 'Unterminated number',
  },
  [Code.InvalidUnicode]: {
    code: 'invalid-unicode',
    message: 'Invalid \\u escape',
    hint: 'A \\u escape needs exactly four hex digits.',
  },
  [Code.InvalidEscapeCharacter]: {
    code: 'invalid-escape',
    message: 'Invalid escape sequence',
    hint: 'JSON allows only \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.',
  },
  [Code.InvalidCharacter]: {
    code: 'invalid-character',
    message: 'Invalid character in string',
    hint: 'Control characters must be escaped inside a JSON string.',
  },
}

const CONTEXT_LINES = 2

/**
 * Walk back from a parse-error offset to a trailing comma, if that is what
 * actually caused it.
 *
 * jsonc-parser reports the position where parsing gave up -- the `}` line --
 * but the actionable character is the comma before it. Pointing the caret at
 * the `}` is technically correct and practically useless.
 */
function trailingCommaBefore(text: string, offset: number): number | null {
  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i]!
    if (ch === ',') return i
    if (!/\s/.test(ch)) return null
  }
  return null
}

/** Start and end (excluding the line break) of a 1-based line. */
function lineBounds(
  text: string,
  index: ReturnType<typeof buildLineIndex>,
  line: number,
): { start: number; end: number } {
  const start = index.starts[line - 1] ?? 0
  let end = index.starts[line] ?? text.length
  if (end > start && text[end - 1] === '\n') end--
  if (end > start && text[end - 1] === '\r') end--
  return { start, end }
}

function buildIssue(
  text: string,
  err: ParseError,
  index: ReturnType<typeof buildLineIndex>,
  tabWidth: number,
): JsonIssue {
  let info = MESSAGES[err.error] ?? { code: 'parse-error', message: 'Could not parse JSON' }
  let offset = err.offset

  // Re-aim the caret at the trailing comma itself, and say so plainly.
  const comma =
    err.error === Code.PropertyNameExpected || err.error === Code.ValueExpected
      ? trailingCommaBefore(text, err.offset)
      : null
  if (comma !== null) {
    offset = comma
    const closer = text[err.offset] === ']' ? ']' : '}'
    info = {
      code: 'trailing-comma',
      message: `Trailing comma before ${closer}`,
      hint: 'Strict JSON does not allow a comma after the last item. Remove it, or enable lenient mode.',
    }
  }

  const { line, column } = offsetToLineCol(index, offset)

  const from = Math.max(1, line - CONTEXT_LINES)
  const to = Math.min(index.lineCount, line + CONTEXT_LINES)
  const bounds: Array<{ start: number; end: number }> = []
  let longest = 0
  for (let n = from; n <= to; n++) {
    const b = lineBounds(text, index, n)
    bounds.push(b)
    longest = Math.max(longest, b.end - b.start)
  }

  // Short lines are shown whole. Otherwise every line is cut to the same
  // column window around the caret, so the context still lines up -- and only
  // the window is ever sliced, never the whole line.
  const windowed = longest > SNIPPET_MAX_LINE
  const winStart = windowed ? Math.max(0, column - 1 - SNIPPET_WINDOW / 2) : 0
  const lines = bounds.map((b, i) => {
    const number = from + i
    if (!windowed) return { number, text: text.slice(b.start, b.end) }
    const length = b.end - b.start
    const sliceEnd = Math.min(length, winStart + SNIPPET_WINDOW)
    const body = length > winStart ? text.slice(b.start + winStart, b.start + sliceEnd) : ''
    const before = winStart > 0 && length > 0 ? '…' : ''
    const after = length > sliceEnd ? '…' : ''
    return { number, text: before + body + after }
  })

  const caret = lines[line - from]!.text
  // Column within the shown text: shifted by the window and its leading '…'.
  const shownColumn = column - winStart + (windowed && winStart > 0 ? 1 : 0)

  return {
    severity: 'error',
    code: info.code,
    message: info.message,
    hint: info.hint ?? null,
    offset,
    length: err.length,
    line,
    column,
    snippet: {
      lines,
      caretLine: line,
      // Tab-aware, so the caret lands under the real character.
      caretColumn: visualColumn(caret, shownColumn, tabWidth),
    },
  }
}

/** Detect one-JSON-value-per-line input, the most common thing pasted from logs. */
function detectNdjson(text: string): { records: number } | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return null
  for (const line of lines) {
    try {
      JSON.parse(line)
    } catch {
      return null
    }
  }
  return { records: lines.length }
}

export interface AnalyzeOptions {
  /** Accept comments and trailing commas. */
  lenient: boolean
  tabWidth?: number
}

export function analyze(text: string, o: AnalyzeOptions): Analysis {
  if (text.trim() === '') return { issues: [], flavor: 'empty', ndjson: null, moreIssues: false }

  // Fast path: native JSON.parse. On 21MB this is ~170ms, so there is no
  // reason to reach for anything cleverer when the input is valid.
  try {
    const value = JSON.parse(text) as unknown
    return { value, issues: [], flavor: 'json', ndjson: null, moreIssues: false }
  } catch {
    /* fall through to the reporting parser */
  }

  // A visitor, not parseTree: only the errors are needed, and building the
  // node tree for a 20 MB document costs twice as much for nothing. Errors past
  // the cap are counted, never kept -- prose yields one per word.
  const errors: ParseError[] = []
  let moreIssues = false
  visit(
    text,
    {
      onError: (error, offset, length) => {
        if (errors.length < MAX_ISSUES * 4) errors.push({ error, offset, length })
        else moreIssues = true
      },
    },
    {
      allowTrailingComma: o.lenient,
      disallowComments: !o.lenient,
      allowEmptyContent: false,
    },
  )

  const index = buildLineIndex(text)

  // jsonc-parser often emits several codes for one mistake at the same spot
  // (a trailing comma yields both PropertyNameExpected and ValueExpected).
  // Reporting each one separately reads as multiple unrelated problems, so
  // keep the first issue per resolved offset -- it is the most specific.
  const seen = new Set<number>()
  const issues: JsonIssue[] = []
  for (const err of errors) {
    if (issues.length === MAX_ISSUES) {
      moreIssues = true
      break
    }
    const issue = buildIssue(text, err, index, o.tabWidth ?? 2)
    if (seen.has(issue.offset)) continue
    seen.add(issue.offset)
    issues.push(issue)
  }

  const ndjson = detectNdjson(text)

  // In lenient mode the input may be perfectly good JSONC -- comments and
  // trailing commas produce no errors at all under these options -- so always
  // try to recover a value here, not only when errors were reported.
  if (o.lenient) {
    try {
      const value = JSON.parse(stripJsonc(text)) as unknown
      return { value, issues, flavor: 'jsonc', ndjson, moreIssues }
    } catch {
      /* genuinely not recoverable; fall through to the invalid result */
    }
  }

  return {
    issues,
    flavor: ndjson ? 'ndjson' : 'invalid',
    ndjson,
    moreIssues,
  }
}

/**
 * Remove comments and trailing commas so the result is strict JSON.
 * String-aware, so a `//` inside a string value survives.
 *
 * Kept text is copied in slices between removals, not a character at a time:
 * per-character concatenation took over a second on 20 MB.
 */
export function stripJsonc(text: string): string {
  const out: string[] = []
  // Start of the text not yet copied to `out`.
  let kept = 0
  let i = 0
  const n = text.length

  const drop = (from: number, to: number) => {
    if (from > kept) out.push(text.slice(kept, from))
    kept = Math.min(to, n)
  }

  while (i < n) {
    const ch = text[i]!

    if (ch === '"') {
      i++
      while (i < n) {
        const c = text.charCodeAt(i)
        if (c === 0x5c /* backslash */) {
          i += 2
        } else {
          i++
          if (c === 0x22 /* quote */) break
        }
      }
      continue
    }

    if (ch === '/' && text[i + 1] === '/') {
      let j = text.indexOf('\n', i)
      if (j === -1) j = n
      drop(i, j)
      i = j
      continue
    }

    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      const j = close === -1 ? n : close + 2
      drop(i, j)
      i = j
      continue
    }

    if (ch === ',') {
      // Look ahead past whitespace and comments for a closing bracket.
      let j = i + 1
      while (j < n) {
        const c = text[j]!
        if (/\s/.test(c)) {
          j++
        } else if (c === '/' && text[j + 1] === '/') {
          while (j < text.length && text[j] !== '\n') j++
        } else if (c === '/' && text[j + 1] === '*') {
          j += 2
          while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++
          j += 2
        } else {
          break
        }
      }
      if (text[j] === '}' || text[j] === ']') drop(i, i + 1) // the trailing comma
    }

    i++
  }

  if (kept < n) out.push(text.slice(kept))
  return out.join('')
}
