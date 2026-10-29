import { fail, hex, isHexDigit, ok, show, type EscapeResult } from './result.ts'

export interface JsonEscapeOptions {
  /** Include the surrounding double quotes. Default true. */
  wrap?: boolean
  /** Write every non-ASCII character as `\uXXXX` (astral ones as a surrogate pair). Default false. */
  asciiOnly?: boolean
}

/**
 * Exactly `JSON.stringify(s)`, which since ES2019 also escapes lone surrogates,
 * so the output is always valid UTF-8 JSON. U+2028/2029 stay raw: JSON allows
 * them, and JavaScript has accepted them in strings since ES2019 too.
 */
export function escapeJson(s: string, opts: JsonEscapeOptions = {}): string {
  let out = JSON.stringify(s)
  if (opts.asciiOnly === true) {
    // Per UTF-16 code unit (no `u` flag), so an emoji becomes the surrogate
    // pair JSON requires; lowercase to match what JSON.stringify itself writes.
    out = out.replace(/[^\x20-\x7e]/g, (c) => `\\u${hex(c.charCodeAt(0), 4).toLowerCase()}`)
  }
  return opts.wrap === false ? out.slice(1, -1) : out
}

const SIMPLE: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/** Insignificant whitespace in JSON: exactly these four, not String#trim's list. */
function isJsonSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r'
}

const CONTROL_HINT: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
}

/**
 * Strict JSON string unescaping, with the position of the first problem.
 *
 * A quoted literal (`"…"`, optionally surrounded by whitespace) is parsed
 * exactly as `JSON.parse` would; anything else is taken as the body of a
 * string, where a raw `"` is an error because it would end the string. The
 * one leniency is that trailing line breaks after a body are dropped: they are
 * almost always the newline a copy from a terminal or editor picked up.
 */
export function unescapeJson(input: string): EscapeResult {
  let start = 0
  while (isJsonSpace(input[start])) start++
  const quoted = input[start] === '"'

  let end = input.length
  if (!quoted) {
    while (end > 0 && (input[end - 1] === '\n' || input[end - 1] === '\r')) end--
  }

  let out = ''
  let i = quoted ? start + 1 : 0
  let run = i
  for (; i < end; i++) {
    const c = input[i]!
    if (c === '"') {
      if (!quoted) return fail(input, i, 'Unescaped "', 'write it as \\" inside a JSON string')
      out += input.slice(run, i)
      for (let j = i + 1; j < input.length; j++) {
        if (!isJsonSpace(input[j])) {
          return fail(input, j, 'Text after the closing quote', 'a JSON string ends at its first unescaped "')
        }
      }
      return ok(out)
    }
    if (c === '\\') {
      out += input.slice(run, i)
      const e = input[i + 1]
      if (e === undefined || i + 1 >= end) {
        return fail(input, i, 'Lone backslash at the end', 'write a literal backslash as \\\\')
      }
      const simple = SIMPLE[e]
      if (simple !== undefined) {
        out += simple
        i++
      } else if (e === 'u') {
        const digits = input.slice(i + 2, i + 6)
        if (digits.length < 4 || ![...digits].every(isHexDigit) || i + 6 > end) {
          return fail(
            input,
            i,
            'Incomplete \\u escape',
            input[i + 2] === '{'
              ? '\\u{…} is JavaScript, not JSON; JSON needs exactly four hex digits, like \\u00e9'
              : 'it needs exactly four hex digits, like \\u00e9',
          )
        }
        out += String.fromCharCode(Number.parseInt(digits, 16))
        i += 5
      } else {
        const ch = String.fromCodePoint(input.codePointAt(i + 1)!)
        return fail(
          input,
          i,
          `Invalid escape \\${show(ch)}`,
          e === "'"
            ? "JSON strings don't escape single quotes; write ' as is"
            : 'JSON allows only \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX',
        )
      }
      run = i + 1
      continue
    }
    if (c < ' ') {
      const fix = CONTROL_HINT[c] ?? `\\u${hex(c.charCodeAt(0), 4).toLowerCase()}`
      return fail(input, i, `Raw control character ${show(c)}`, `JSON strings must write it as ${fix}`)
    }
  }

  if (quoted) return fail(input, start, 'Unterminated string', 'the opening quote is never closed')
  return ok(out + input.slice(run, end))
}
