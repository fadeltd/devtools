import { fail, isHexDigit, ok, type EscapeResult } from './result.ts'

/**
 * Every character with a meaning in a pattern outside a character class, plus
 * `/` so the result also drops into a `/…/` literal. All of these are legal
 * escapes under the `u` and `v` flags as well, unlike escaping `-` or a letter.
 */
const SYNTAX = /[\\^$.*+?()[\]{}|/]/
const SYNTAX_G = /[\\^$.*+?()[\]{}|/\n\r\u2028\u2029]/g

const LINE: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

/**
 * A pattern that matches exactly `s`, with any flags. Line terminators are
 * written as escapes, which a `RegExp` doesn't need but a regex literal does.
 */
export function escapeRegex(s: string): string {
  return s.replace(SYNTAX_G, (c) => LINE[c] ?? `\\${c}`)
}

const SIMPLE: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  f: '\f',
  v: '\v',
}

const CLASSES: Record<string, string> = {
  d: 'a digit class',
  D: 'a non-digit class',
  w: 'a word-character class',
  W: 'a non-word-character class',
  s: 'a whitespace class',
  S: 'a non-whitespace class',
  b: 'a word boundary',
  B: 'a non-boundary',
  p: 'a Unicode property class',
  P: 'a Unicode property class',
  k: 'a named backreference',
}

/**
 * The reverse, for a pattern that is a plain literal: the exact string it
 * matches. Anything that makes the pattern match more than one string (an
 * unescaped `.`, a `\d`, a group) is an error at its position, because such a
 * pattern has no single text to give back.
 */
export function unescapeRegex(input: string): EscapeResult {
  let out = ''
  let run = 0
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (c !== '\\') {
      if (c !== '/' && SYNTAX.test(c)) {
        return fail(input, i, `Unescaped ${c}`, 'it is regex syntax, so this pattern is not a plain literal; escape it as \\' + c)
      }
      continue
    }
    out += input.slice(run, i)
    const e = input[i + 1]
    if (e === undefined) return fail(input, i, 'Lone backslash at the end', 'write a literal backslash as \\\\')

    const simple = SIMPLE[e]
    const what = CLASSES[e]
    if (simple !== undefined) {
      out += simple
      i++
    } else if (what !== undefined) {
      return fail(input, i, `\\${e} is ${what}`, 'it matches a set of strings, not one literal')
    } else if (e === '0' && !/[0-9]/.test(input[i + 2] ?? '')) {
      out += '\0'
      i++
    } else if (e >= '0' && e <= '9') {
      return fail(input, i, `\\${e} is a backreference`, 'it repeats a group, so it is not a literal')
    } else if (e === 'x') {
      if (!isHexDigit(input[i + 2]) || !isHexDigit(input[i + 3])) {
        return fail(input, i, 'Incomplete \\x escape', 'it needs exactly two hex digits, like \\x41')
      }
      out += String.fromCharCode(Number.parseInt(input.slice(i + 2, i + 4), 16))
      i += 3
    } else if (e === 'u' && input[i + 2] === '{') {
      const close = input.indexOf('}', i + 3)
      const digits = close === -1 ? '' : input.slice(i + 3, close)
      const cp = Number.parseInt(digits, 16)
      if (digits === '' || ![...digits].every(isHexDigit) || cp > 0x10ffff) {
        return fail(input, i, 'Malformed \\u{…} escape', 'it needs up to six hex digits no higher than 10FFFF, like \\u{1F600}')
      }
      out += String.fromCodePoint(cp)
      i = close
    } else if (e === 'u') {
      const digits = input.slice(i + 2, i + 6)
      if (digits.length < 4 || ![...digits].every(isHexDigit)) {
        return fail(input, i, 'Incomplete \\u escape', 'it needs four hex digits, like \\u00E9')
      }
      out += String.fromCharCode(Number.parseInt(digits, 16))
      i += 5
    } else if (e === 'c' && /[A-Za-z]/.test(input[i + 2] ?? '')) {
      out += String.fromCharCode(input.charCodeAt(i + 2) % 32)
      i += 2
    } else if (/[A-Za-z]/.test(e)) {
      return fail(input, i, `Unknown escape \\${e}`, 'it is not a character escape, and the u flag rejects it')
    } else {
      // Identity escape of punctuation: \. \- \, \/ …
      out += e
      i++
    }
    run = i + 1
  }
  return ok(out + input.slice(run))
}

