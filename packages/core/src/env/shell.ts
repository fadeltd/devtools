import { EntryCollector, shortKey } from './collect.ts'
import { SHELL_KEY, type EnvDoc } from './types.ts'

/**
 * Read `export KEY=word` lines as a POSIX shell would assign them, without
 * running anything. A word is any mix of:
 *
 * - `'…'`: literal, may span lines
 * - `"…"`: `\` escapes only `$`, `` ` ``, `"`, `\` and a line break
 * - `\c`: the character itself; `\` + line break joins lines
 * - anything else up to unquoted whitespace or `;` (a `#` inside a word is literal)
 *
 * Parameter expansion and command substitution are not performed: `$X` stays
 * `$X`. This exists to check toShell output, and to read it back.
 */
export function parseShellExports(input: string): EnvDoc {
  // No CRLF normalisation: a CR inside single quotes is part of the value, as
  // it is to sh. Outside quotes a CR is just a blank.
  const text = input
  const out = new EntryCollector()
  let p = 0
  let line = 1

  const advance = (to: number) => {
    for (; p < to; p++) if (text[p] === '\n') line++
  }
  const skipToEol = () => {
    const nl = text.indexOf('\n', p)
    advance(nl < 0 ? text.length : nl)
  }

  while (p < text.length) {
    // Leading blanks and blank lines.
    while (p < text.length && /[ \t\r\n]/.test(text[p]!)) advance(p + 1)
    if (p >= text.length) break
    const start = line

    if (text[p] === '#') {
      skipToEol()
      continue
    }

    const exp = /export[ \t]+/y
    exp.lastIndex = p
    if (exp.test(text)) advance(exp.lastIndex)

    const name = /[^=\s;#]*/y
    name.lastIndex = p
    const key = name.exec(text)![0]
    if (text[p + key.length] !== '=' || !SHELL_KEY.test(key)) {
      out.error(start, key === '' ? 'Expected export KEY=value.' : `"${shortKey(key)}" is not a valid assignment.`)
      skipToEol()
      continue
    }
    advance(p + key.length + 1)

    let value = ''
    let ok = true
    word: while (p < text.length) {
      const c = text[p]!
      if (c === "'") {
        const close = text.indexOf("'", p + 1)
        if (close < 0) {
          out.error(start, `${key}: the single quote is never closed.`)
          ok = false
          break
        }
        value += text.slice(p + 1, close)
        advance(close + 1)
      } else if (c === '"') {
        let q = p + 1
        let body = ''
        for (;;) {
          if (q >= text.length) {
            out.error(start, `${key}: the double quote is never closed.`)
            ok = false
            break word
          }
          const d = text[q]!
          if (d === '"') break
          if (d === '\\' && q + 1 < text.length) {
            const e = text[q + 1]!
            if (e === '\n') {
              q += 2
              continue
            }
            if ('$`"\\'.includes(e)) {
              body += e
              q += 2
              continue
            }
          }
          body += d
          q++
        }
        value += body
        advance(q + 1)
      } else if (c === '\\') {
        const e = text[p + 1]
        if (e !== undefined && e !== '\n') value += e
        advance(p + 2)
      } else if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ';') {
        break
      } else {
        value += c
        advance(p + 1)
      }
    }

    if (!ok) {
      // Nothing after an unclosed quote can be trusted.
      break
    }
    // The rest of the line may only be blanks, `;` or a comment.
    const tail = /[ \t\r;]*(?:#[^\n]*)?(?:\n|$)/y
    tail.lastIndex = p
    if (!tail.test(text)) {
      out.error(line, `${key}: unexpected text after the value.`)
      skipToEol()
      continue
    }
    out.add({ key, value, line: start })
    advance(tail.lastIndex)
  }

  return out.done()
}
