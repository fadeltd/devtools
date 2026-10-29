import { fail, ok, type EscapeResult } from './result.ts'

/**
 * Quote one argument for POSIX `sh` (and bash, zsh, dash, ksh).
 *
 * Inside single quotes nothing is special, not even a backslash, so the only
 * character that needs care is `'` itself: close the quote, add an escaped
 * quote, reopen (`'\''`). That makes the output safe for any input, with no
 * list of metacharacters to get wrong. Always quoted, even when it isn't
 * strictly needed, so the result is predictable and an empty string stays an
 * argument (`''`).
 */
export function escapeShell(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`
}

export function shellWarnings(s: string): string[] {
  return s.includes('\0')
    ? ['The text has a NUL character (U+0000). No shell argument can hold one: the program receives the text cut short there.']
    : []
}

const SPACE = /[ \t\n]/
const OPERATOR = /[|&;<>()]/
// What can follow `$` to start an expansion: a name, a positional or special
// parameter, `${…}`, `$(…)`.
const EXPANSION = /[A-Za-z0-9_{(@*#?$!-]/

/**
 * Turn one shell word back into the text the program would receive, without
 * running anything. Single quotes, double quotes and backslashes are
 * resolved; anything that would expand (`$x`, `$(…)`, backticks), split the
 * word, or act as shell syntax is reported, because its value depends on a
 * running shell.
 */
export function unescapeShell(input: string): EscapeResult {
  let start = 0
  let stop = input.length
  while (SPACE.test(input[start] ?? '')) start++
  while (stop > start && SPACE.test(input[stop - 1]!)) stop--

  const warnings: string[] = []
  let out = ''
  for (let i = start; i < stop; i++) {
    const c = input[i]!

    if (c === "'") {
      const close = input.indexOf("'", i + 1)
      if (close === -1 || close >= stop) {
        return fail(input, i, 'Unterminated single quote', "add a closing '")
      }
      out += input.slice(i + 1, close)
      i = close
    } else if (c === '"') {
      let j = i + 1
      for (; j < stop; j++) {
        const d = input[j]!
        if (d === '"') break
        if (d === '\\') {
          // Inside double quotes a backslash escapes only these; before
          // anything else it is a literal backslash.
          const e = input[j + 1]
          if (e === '$' || e === '`' || e === '"' || e === '\\') {
            out += e
            j++
          } else if (e === '\n') {
            j++
          } else {
            out += d
          }
        } else if (d === '`' || (d === '$' && EXPANSION.test(input[j + 1] ?? ''))) {
          return expansion(input, j)
        } else {
          out += d
        }
      }
      if (j >= stop) return fail(input, i, 'Unterminated double quote', 'add a closing "')
      i = j
    } else if (c === '\\') {
      const e = input[i + 1]
      if (e === undefined || i + 1 >= stop) {
        return fail(input, i, 'Lone backslash at the end', "the shell would wait for another line; write it as '\\'")
      }
      if (e !== '\n') out += e
      i++
    } else if (SPACE.test(c)) {
      return fail(input, i, 'Unquoted whitespace', 'the shell splits the text into separate arguments here; quote it')
    } else if (c === '`' || (c === '$' && EXPANSION.test(input[i + 1] ?? ''))) {
      return expansion(input, i)
    } else if (c === '$' && input[i + 1] === "'") {
      return fail(input, i, "$'…' quoting", 'that is a Bash extension, not POSIX sh')
    } else if (OPERATOR.test(c)) {
      return fail(input, i, `Unquoted ${c}`, 'it is shell syntax, not part of the argument; quote it')
    } else if (c === '#' && i === start) {
      return fail(input, i, 'Unquoted # starts a comment', 'the shell ignores the rest of the line; quote it')
    } else if (c === '~' && i === start) {
      return fail(input, i, 'Unquoted ~', 'the shell replaces it with a home directory; quote it')
    } else {
      if ((c === '*' || c === '?' || c === '[') && warnings.length === 0) {
        warnings.push(
          `Unquoted ${c} at position ${i + 1}: the shell would expand it to matching file names, if there are any. The output assumes there are none.`,
        )
      }
      out += c
    }
  }
  return ok(out, warnings)
}

function expansion(input: string, i: number): EscapeResult {
  return input[i] === '`'
    ? fail(input, i, 'Command substitution `…`', 'its value comes from running a command; quote it with single quotes')
    : fail(input, i, 'Unquoted $', 'the shell expands it to a variable or a command’s output; put it in single quotes')
}
