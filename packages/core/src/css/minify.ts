// A space touching one of these never separates two tokens that would
// otherwise merge, in a selector or a value.
const TIGHT = new Set(['{', '}', ';', ',', '>', '~', '!'])
const HEX = /[0-9a-fA-F]/
const SPACE = /\s/

/** Whether the run of whitespace between `prev` and `next` must stay as one space. */
function needsSpace(prev: string, next: string, parenDepth: number): boolean {
  if (TIGHT.has(prev) || TIGHT.has(next) || prev === '\n') return false
  // `a :hover` (any descendant that is hovered) is not `a:hover`, so only the
  // space after a colon can go. Likewise `and (` in a media query must keep
  // its space, or `and(` turns into a function call.
  if (prev === ':' || prev === '(' || next === ')') return false
  // Inside parentheses `+` may be calc() arithmetic, where the spaces are
  // mandatory: `calc(1px+2px)` is invalid. Outside, it is a combinator.
  if (parenDepth === 0 && (prev === '+' || next === '+')) return false
  return true
}

/**
 * Index just past a string opened at `start`. An unescaped newline ends a CSS
 * string (as a parse error); it is taken along, because collapsing it into a
 * space would let the broken string swallow the next line.
 */
function scanString(s: string, start: number): number {
  const quote = s[start]
  let i = start + 1
  while (i < s.length) {
    const ch = s[i]!
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    if (ch === '\n') return i + 1
    i++
  }
  return s.length
}

/** Index just past a backslash escape at `start`, including the space that may end a hex escape. */
function scanEscape(s: string, start: number): number {
  let i = start + 1
  if (i >= s.length) return i
  if (!HEX.test(s[i]!)) return i + 1
  const limit = i + 6
  while (i < s.length && i < limit && HEX.test(s[i]!)) i++
  // `\31 0` is ".10": that one space belongs to the escape, not to the layout.
  if (i < s.length && SPACE.test(s[i]!)) i += s.startsWith('\r\n', i) ? 2 : 1
  return i
}

/**
 * Minify plain CSS by hand, without a parser:
 *
 * - comments go, except `/*! … *\/`, which by convention holds a licence;
 * - whitespace collapses, and disappears where no token needs it;
 * - strings, escapes and unquoted `url(…)` bodies are copied verbatim, so a
 *   data URI or a `content: "{"` survives untouched;
 * - the last semicolon in each block goes, and so do empty declarations.
 *
 * SCSS and Less are not handled: `//` comments, interpolation and mixins need
 * their own parsers, and minifying them is the compiler's job.
 */
export function minifyCss(input: string): string {
  let out = ''
  let gap = false
  let depth = 0

  const emit = (piece: string) => {
    if (gap && out !== '' && needsSpace(out.at(-1)!, piece[0]!, depth)) out += ' '
    gap = false
    out += piece
  }

  let i = 0
  while (i < input.length) {
    const ch = input[i]!

    if (SPACE.test(ch)) {
      while (i < input.length && SPACE.test(input[i]!)) i++
      gap = true
      continue
    }

    if (input.startsWith('/*', i)) {
      const close = input.indexOf('*/', i + 2)
      const end = close === -1 ? input.length : close + 2
      const comment = input.slice(i, end)
      if (comment.startsWith('/*!')) emit(comment)
      // A dropped comment still separates what was either side of it:
      // `1px/**/solid` must not become `1pxsolid`.
      else gap = true
      i = end
      continue
    }

    if (ch === '"' || ch === "'") {
      const end = scanString(input, i)
      emit(input.slice(i, end))
      i = end
      continue
    }

    if (ch === '\\') {
      const end = scanEscape(input, i)
      emit(input.slice(i, end))
      i = end
      continue
    }

    // Only the tail is tested: an end-anchored regex over all of `out` would
    // rescan it on every parenthesis.
    if (ch === '(' && /(?:^|[^\w-])url$/i.test(out.slice(-4))) {
      // An unquoted url() body is one token: its `;`, `,` and `+` are data.
      let j = i + 1
      while (j < input.length && SPACE.test(input[j]!)) j++
      if (input[j] !== '"' && input[j] !== "'") {
        let k = j
        while (k < input.length && input[k] !== ')') k += input[k] === '\\' ? 2 : 1
        // Unterminated: copy the rest as it is rather than invent a `)`.
        const closed = k < input.length
        emit(`(${input.slice(j, Math.min(k, input.length)).trimEnd()}${closed ? ')' : ''}`)
        i = closed ? k + 1 : input.length
        continue
      }
    }

    if (ch === ';') {
      // `;;` and `{;` are empty declarations.
      gap = false
      if (out.endsWith(';') || out.endsWith('{') || out === '') {
        i++
        continue
      }
    }
    if (ch === '}' && out.endsWith(';')) out = out.slice(0, -1)
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)

    emit(ch)
    i++
  }

  return out
}
