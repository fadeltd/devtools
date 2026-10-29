import { fail, hex, isHexDigit, ok, type EscapeResult } from './result.ts'

export type JsQuote = '"' | "'" | '`'

export interface JsEscapeOptions {
  /** Which literal the text goes into. Default `"`. */
  quote?: JsQuote
  /** Include the surrounding quotes. Default true. */
  wrap?: boolean
  /** Write every non-ASCII character as an escape: `\xHH`, `\uHHHH` or `\u{HHHHH}`. Default false. */
  asciiOnly?: boolean
}

const NAMED: Record<number, string> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0b: '\\v',
  0x0c: '\\f',
  0x0d: '\\r',
  0x5c: '\\\\',
}

/**
 * Escape text for a JavaScript string literal of the chosen quote style.
 *
 * Beyond the obvious, three things free tools miss: U+2028/2029 are escaped so
 * the output also survives pre-ES2019 engines and JSONP-style embedding; lone
 * surrogates are escaped so the source file stays valid UTF-8; and in a
 * template literal `${` is escaped so the text is never run as code. `\0` is
 * written as `\x00` before a digit, where `\01` would be a legacy octal escape.
 */
export function escapeJs(s: string, opts: JsEscapeOptions = {}): string {
  const quote = opts.quote ?? '"'
  const q = quote.charCodeAt(0)
  const ascii = opts.asciiOnly === true
  let out = ''
  let run = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    let rep: string | undefined
    let width = 1

    if (c >= 0x20 && c < 0x7f) {
      if (c === q || (c === 0x24 && q === 0x60 && s.charCodeAt(i + 1) === 0x7b)) rep = `\\${s[i]}`
      else if (c === 0x5c) rep = '\\\\'
      else continue
    } else if (c < 0x20) {
      rep = NAMED[c] ?? (c === 0 && !/[0-9]/.test(s[i + 1] ?? '') ? '\\0' : `\\x${hex(c, 2)}`)
    } else if (c <= 0x9f) {
      // DEL and the C1 controls: invisible, and some editors mangle them.
      rep = `\\x${hex(c, 2)}`
    } else if (c === 0x2028 || c === 0x2029) {
      rep = `\\u${hex(c, 4)}`
    } else if (c >= 0xd800 && c <= 0xdfff) {
      const next = s.charCodeAt(i + 1)
      const paired = c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
      if (!paired) rep = `\\u${hex(c, 4)}`
      else if (ascii) {
        rep = `\\u{${hex(s.codePointAt(i)!, 1)}}`
        width = 2
      } else {
        i++
        continue
      }
    } else if (ascii) {
      rep = c <= 0xff ? `\\x${hex(c, 2)}` : `\\u${hex(c, 4)}`
    } else {
      continue
    }

    out += s.slice(run, i) + rep
    i += width - 1
    run = i + 1
  }
  out += s.slice(run)
  return opts.wrap === false ? out : quote + out + quote
}

function isJsSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r'
}

const SIMPLE: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
}

/**
 * Unescape a JavaScript string with strict-mode rules.
 *
 * Text that starts and ends with the same quote is read as a whole literal:
 * the quote must not appear unescaped inside, a `'`/`"` literal may not span
 * lines, and a template may not contain `${`, which is code with no fixed
 * value. Anything else is read as the body of a string, where quotes and line
 * breaks are taken as they are. Legacy octal escapes are errors, as they are
 * in strict mode and in templates.
 */
export function unescapeJs(input: string): EscapeResult {
  let start = 0
  let stop = input.length
  while (isJsSpace(input[start])) start++
  while (stop > start && isJsSpace(input[stop - 1])) stop--
  const first = input[start]
  const quoted =
    stop - start >= 2 && (first === '"' || first === "'" || first === '`') && input[stop - 1] === first
  const quote = quoted ? first : undefined
  const from = quoted ? start + 1 : 0
  const to = quoted ? stop - 1 : input.length

  let out = ''
  let run = from
  for (let i = from; i < to; i++) {
    const c = input[i]!

    if (quote !== undefined) {
      if (c === quote) {
        return fail(input, i, `Unescaped ${quote}`, `it ends the string; write it as \\${quote}`)
      }
      if ((c === '\n' || c === '\r') && quote !== '`') {
        return fail(input, i, 'Raw line break', 'only template literals may span lines; write it as \\n')
      }
      if (quote === '`' && c === '$' && input[i + 1] === '{') {
        return fail(input, i, 'Template substitution ${', 'it is code with no fixed value; write \\${ to mean the text')
      }
      if (quote === '`' && c === '\r') {
        // A template's cooked value normalises CRLF and CR to LF.
        out += `${input.slice(run, i)}\n`
        if (input[i + 1] === '\n') i++
        run = i + 1
        continue
      }
    }

    if (c !== '\\') continue
    out += input.slice(run, i)
    const e = input[i + 1]
    if (e === undefined || i + 1 >= to) {
      return quoted
        ? fail(input, i, 'Unterminated string', 'this backslash escapes the closing quote')
        : fail(input, i, 'Lone backslash at the end', 'write a literal backslash as \\\\')
    }

    const simple = SIMPLE[e]
    if (simple !== undefined) {
      out += simple
      i++
    } else if (e >= '0' && e <= '9') {
      const next = input[i + 2]
      if (e !== '0' || (next !== undefined && next >= '0' && next <= '9' && i + 2 < to)) {
        return fail(
          input,
          i,
          `Legacy octal escape \\${e}`,
          'strict mode and template literals reject it; write \\xHH or \\u{…} instead',
        )
      }
      out += '\0'
      i++
    } else if (e === 'x') {
      if (!isHexDigit(input[i + 2]) || !isHexDigit(input[i + 3]) || i + 3 >= to) {
        return fail(input, i, 'Incomplete \\x escape', 'it needs exactly two hex digits, like \\x41')
      }
      out += String.fromCharCode(Number.parseInt(input.slice(i + 2, i + 4), 16))
      i += 3
    } else if (e === 'u' && input[i + 2] === '{') {
      const close = input.indexOf('}', i + 3)
      const digits = close === -1 || close >= to ? '' : input.slice(i + 3, close)
      if (digits === '' || ![...digits].every(isHexDigit)) {
        return fail(input, i, 'Malformed \\u{…} escape', 'it needs hex digits and a closing brace, like \\u{1F600}')
      }
      const cp = Number.parseInt(digits, 16)
      if (cp > 0x10ffff) {
        return fail(input, i, `Code point \\u{${digits}} is out of range`, 'the largest is \\u{10FFFF}')
      }
      out += String.fromCodePoint(cp)
      i = close
    } else if (e === 'u') {
      const digits = input.slice(i + 2, i + 6)
      if (digits.length < 4 || ![...digits].every(isHexDigit) || i + 5 >= to) {
        return fail(input, i, 'Incomplete \\u escape', 'it needs four hex digits like \\u00E9, or braces like \\u{1F600}')
      }
      out += String.fromCharCode(Number.parseInt(digits, 16))
      i += 5
    } else if (e === '\r') {
      // Line continuation: backslash-newline contributes nothing.
      i += input[i + 2] === '\n' ? 2 : 1
    } else if (e === '\n' || e === '\u2028' || e === '\u2029') {
      i++
    } else {
      // Any other escaped character stands for itself: \' \" \` \\ \$ \a …
      // Only the first half of a surrogate pair is consumed here; the second is
      // copied by the next run.
      out += e
      i++
    }
    run = i + 1
  }
  return ok(out + input.slice(run, to))
}
