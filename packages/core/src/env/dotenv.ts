import { parseLines } from '../list/lines.ts'
import { EntryCollector, shortKey } from './collect.ts'
import { ENV_KEY, type EnvDoc } from './types.ts'

type Quote = '"' | "'" | '`'

const QUOTE_NAME: Record<Quote, string> = { '"': 'double quote', "'": 'single quote', '`': 'backtick' }

const EXPORT = /^export[ \t]+/

/**
 * Parse a .env file the way `dotenv` reads one.
 *
 * - `KEY=value`, optional `export `, spaces around `=`, empty values.
 * - Full-line `#` comments, and inline ones after an unquoted value.
 * - Single quotes and backticks are literal; double quotes process `\n`, `\r`,
 *   `\t`, `\"` and `\\`, and any of the three may span lines.
 * - CRLF, lone CR and a BOM are handled by parseLines, so no `\r` ever ends up
 *   glued to a value.
 *
 * One deliberate difference: an inline comment needs whitespace before its `#`,
 * as in sh, Docker Compose and python-dotenv. Node's dotenv cuts `pass#word` to
 * `pass`; we keep it and warn, because silently truncating a password is the
 * worse failure.
 */
export function parseDotenv(text: string): EnvDoc {
  const { lines } = parseLines(text)
  const out = new EntryCollector()

  let i = 0
  while (i < lines.length) {
    const line = i + 1
    let s = lines[i]!.trimStart()
    i++
    if (s === '' || s.startsWith('#')) continue

    const exp = EXPORT.exec(s)
    if (exp !== null) s = s.slice(exp[0].length)

    const eq = s.indexOf('=')
    if (eq < 0) {
      const bare = s.trimEnd()
      // Only echo the text when it is a plausible key: a line with no `=` may
      // well be a pasted secret.
      out.error(
        line,
        ENV_KEY.test(bare)
          ? `${shortKey(bare)} has no "=". Write ${shortKey(bare)}= for an empty value.`
          : 'Expected KEY=value.',
      )
      continue
    }

    const key = s.slice(0, eq).trimEnd()
    if (!ENV_KEY.test(key)) {
      out.error(
        line,
        key === ''
          ? 'Missing a key before "=".'
          : `"${shortKey(key)}" is not a valid key. Use letters, digits, _, . and -, not starting with a digit.`,
      )
      continue
    }

    const rest = s.slice(eq + 1).trimStart()
    const q = rest[0]

    if (q === '"' || q === "'" || q === '`') {
      const r = readQuoted(lines, i - 1, rest.slice(1), q)
      if (r === null) {
        out.error(line, `${key}: the ${QUOTE_NAME[q]} is never closed.`)
        continue
      }
      const after = r.after.trim()
      if (after !== '' && !after.startsWith('#')) {
        out.error(line, `${key}: unexpected text after the closing ${QUOTE_NAME[q]}.`)
        // The quoted value may have run over several lines; skip them all, or
        // its body would be re-read as a stream of bogus entries.
        i = r.next
        continue
      }
      i = r.next
      out.add({ key, value: q === '"' ? unescapeDouble(r.body) : r.body, line })
      continue
    }

    const hash = rest.startsWith('#') ? 0 : rest.search(/\s#/)
    const value = (hash < 0 ? rest : rest.slice(0, hash)).trim()
    if (value.includes('#')) {
      out.warn(line, `${key}: Node's dotenv cuts an unquoted value at "#"; quote it so every loader reads it whole.`)
    }
    out.add({ key, value, line })
  }

  return out.done()
}

/**
 * Find the closing quote, pulling in following lines as needed.
 * `start` is the index of the line the value opens on; `first` is that line's
 * text after the opening quote. Returns null when the quote never closes.
 */
function readQuoted(
  lines: readonly string[],
  start: number,
  first: string,
  q: Quote,
): { body: string; after: string; next: number } | null {
  let buf = first
  let next = start + 1
  let p = 0
  for (;;) {
    while (p < buf.length) {
      const ch = buf[p]
      if (q === '"' && ch === '\\') {
        // A backslash at the end of a line escapes the line break, so the
        // next line must be pulled in before we can step over it.
        if (p + 1 >= buf.length) break
        p += 2
        continue
      }
      if (ch === q) return { body: buf.slice(0, p), after: buf.slice(p + 1), next }
      p++
    }
    if (next >= lines.length) return null
    buf += `\n${lines[next]}`
    next++
  }
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }

/**
 * One left-to-right pass, so `\\n` is a backslash then `n`, never a newline.
 * Unknown escapes such as `\$` keep their backslash, as dotenv does.
 */
function unescapeDouble(s: string): string {
  return s.replace(/\\([\s\S])/g, (m, c: string) => ESCAPES[c] ?? m)
}
