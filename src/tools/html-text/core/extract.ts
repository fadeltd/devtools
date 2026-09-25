import { decodeEntities } from './entities'

export { decodeEntities }

export interface ExtractOptions {
  /** Append `<href>` after link text. */
  linkUrls: boolean
  /**
   * Also drop elements whose class *looks* hidden (`hidden`, `sr-only`, ...).
   * A naming-convention guess, so it is opt-in.
   */
  skipHiddenClasses: boolean
}

export const DEFAULT_OPTIONS: ExtractOptions = { linkUrls: false, skipHiddenClasses: false }

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr',
])

/** Content is raw text up to the matching close tag; never parsed as markup. */
const RAW_TEXT = new Set([
  'script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript',
])

/** Never rendered as text, whatever is inside. */
const SKIP = new Set([
  'head', 'script', 'style', 'title', 'template', 'noscript', 'iframe', 'noembed', 'noframes',
  'svg', 'math', 'canvas', 'audio', 'video', 'object',
])

/** Blocks separated by a blank line. `ul`/`ol` are here only at the top level. */
const PARAGRAPH = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'listing', 'table', 'dl', 'ul',
  'ol', 'menu',
])

/** Blocks that start on their own line. Unknown elements are inline, as in a browser. */
const LINE = new Set([
  'address', 'article', 'aside', 'body', 'caption', 'center', 'dd', 'details', 'dialog', 'div',
  'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hgroup', 'hr', 'legend',
  'li', 'main', 'nav', 'option', 'section', 'summary', 'tr',
])

/** Opening one of these closes an open `<p>`, as the HTML parser does. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
])

/** An implicit close never reaches past these. */
const SCOPE = new Set(['table', 'td', 'th', 'caption', 'template', 'button', 'object'])

const HIDDEN_CLASSES = new Set([
  'hidden', 'hide', 'is-hidden', 'sr-only', 'visually-hidden', 'visuallyhidden', 'screen-reader-text',
  'd-none', 'invisible',
])

const LISTS = new Set(['ul', 'ol', 'menu'])

/** Implicit-close rules: [what a start tag closes, where the search stops]. */
const IMPLICIT: Record<string, readonly [ReadonlySet<string>, ReadonlySet<string>]> = {
  li: [new Set(['li']), new Set([...LISTS, ...SCOPE])],
  dt: [new Set(['dt', 'dd']), new Set(['dl', ...SCOPE])],
  dd: [new Set(['dt', 'dd']), new Set(['dl', ...SCOPE])],
  tr: [new Set(['tr']), new Set(['table', 'thead', 'tbody', 'tfoot'])],
  td: [new Set(['td', 'th']), new Set(['tr', 'table'])],
  th: [new Set(['td', 'th']), new Set(['tr', 'table'])],
  body: [new Set(['head']), new Set()],
}
const P = new Set(['p'])
const TR = new Set(['tr'])
const TABLE = new Set(['table'])

const DISPLAY_NONE = /(?:^|;)\s*display\s*:\s*none\s*(?:!important\s*)?(?:;|$)/i
const TAG_NAME = /[a-zA-Z][^ \t\n\f\r/>]*/y
const HTML_WS = /[ \t\n\f\r]+/
// Sticky and possibly empty: `match` returns '' rather than null.
const WS = /[ \t\n\f\r]*/y
const ATTR_NAME = /[^ \t\n\f\r/>=]*/y
const UNQUOTED = /[^ \t\n\f\r>]*/y

function match(re: RegExp, s: string, at: number): string {
  re.lastIndex = at
  return re.exec(s)?.[0] ?? ''
}

interface Open {
  name: string
  /** 0 inline, 1 own line, 2 blank line around. */
  level: 0 | 1 | 2
  skip: boolean
  /** Next number for an `<ol>`. */
  counter: number
  /** Cells seen so far in a `<tr>`. */
  cells: number
  href: string | null
  /** Output length when an `<a>` opened, to read its text back on close. */
  mark: number
}

/**
 * Accumulates output with lazy separators: a block only *requests* a break,
 * and the break is written when (and if) the next real content arrives. That is
 * what keeps empty `<div>`s and leading/trailing blocks from leaving blank
 * lines behind.
 */
class Writer {
  out = ''
  private trailingNewlines = 0
  private lineEmpty = true
  private pendingBreak = 0
  private pendingSpace = false
  /** List marker to print at the start of the next line. */
  marker = ''
  /** Indentation for continuation lines inside a list item. */
  indent = ''

  requestBreak(level: number): void {
    if (level > this.pendingBreak) this.pendingBreak = level
  }

  space(): void {
    this.pendingSpace = true
  }

  word(s: string): void {
    this.flush()
    if (this.lineEmpty) this.startLine()
    else if (this.pendingSpace) this.out += ' '
    this.put(s)
  }

  /** Preformatted text: newlines are kept, nothing is collapsed. */
  verbatim(s: string): void {
    this.flush()
    s.split('\n').forEach((line, i) => {
      if (i > 0) this.newline()
      if (line === '') return
      if (this.lineEmpty) this.startLine()
      this.put(line)
    })
  }

  newline(): void {
    this.out += '\n'
    this.trailingNewlines++
    this.lineEmpty = true
    this.pendingSpace = false
  }

  br(): void {
    this.flush()
    this.newline()
  }

  tab(): void {
    this.flush()
    if (this.lineEmpty) this.startLine()
    this.put('\t')
  }

  private put(s: string): void {
    this.out += s
    this.trailingNewlines = 0
    this.lineEmpty = false
    this.pendingSpace = false
  }

  private flush(): void {
    if (this.pendingBreak > 0 && this.out !== '') {
      while (this.trailingNewlines < this.pendingBreak) this.newline()
    }
    this.pendingBreak = 0
  }

  private startLine(): void {
    this.pendingSpace = false
    if (this.marker !== '') {
      this.out += this.marker
      this.marker = ''
    } else {
      this.out += this.indent
    }
  }
}

interface Tag {
  name: string
  attrs: Map<string, string>
  selfClosing: boolean
  end: number
}

/** Parse a start tag at `i` (which points at `<`). Null if it never closes. */
function readStartTag(html: string, i: number): Tag | null {
  TAG_NAME.lastIndex = i + 1
  const m = TAG_NAME.exec(html)!
  const name = m[0].toLowerCase()
  const attrs = new Map<string, string>()
  let j = i + 1 + m[0].length
  let selfClosing = false
  const n = html.length

  while (j < n) {
    const c = html[j]
    if (c === '>') return { name, attrs, selfClosing, end: j + 1 }
    if (c === '/') {
      selfClosing = html[j + 1] === '>'
      j++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r') {
      j++
      continue
    }
    selfClosing = false

    const attr = match(ATTR_NAME, html, j).toLowerCase()
    j += attr.length
    j += match(WS, html, j).length

    let value = ''
    if (html[j] === '=') {
      j++
      j += match(WS, html, j).length
      const q = html[j]
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, j + 1)
        if (close === -1) return null
        value = html.slice(j + 1, close)
        j = close + 1
      } else {
        value = match(UNQUOTED, html, j)
        j += value.length
      }
    }
    if (!attrs.has(attr)) attrs.set(attr, decodeEntities(value))
  }
  return null
}

function isHidden(attrs: Map<string, string>, opts: ExtractOptions): boolean {
  if (attrs.has('hidden')) return true
  // role="img" makes the children presentational: this is what hides icon
  // ligatures such as <i class="material-icons">expand_less</i>.
  if (attrs.get('role')?.trim().split(HTML_WS)[0] === 'img') return true
  const style = attrs.get('style')
  if (style !== undefined && DISPLAY_NONE.test(style)) return true
  if (opts.skipHiddenClasses) {
    const cls = attrs.get('class')
    if (cls !== undefined && cls.split(HTML_WS).some((c) => HIDDEN_CLASSES.has(c.toLowerCase()))) {
      return true
    }
  }
  return false
}

function usefulHref(href: string | undefined): string | null {
  if (href === undefined) return null
  const h = href.trim()
  if (h === '' || h.startsWith('#') || /^javascript:/i.test(h)) return null
  return h
}

/**
 * Extract the readable text from an HTML fragment or document.
 *
 * A single-pass tokenizer with a light open-element stack -- enough to know
 * which blocks, lists, cells and hidden subtrees we are inside, without
 * building a tree. It never throws: malformed markup degrades the way a
 * browser's would, or close to it.
 */
export function htmlToText(input: string, options: Partial<ExtractOptions> = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const html = input.replace(/\r\n?/g, '\n')
  const n = html.length
  const w = new Writer()
  const stack: Open[] = []
  let skipDepth = 0
  let preDepth = 0
  let listDepth = 0
  let itemDepth = 0
  /** Set right after `<pre>`: its first newline is not content. */
  let preStart = false

  const syncIndent = () => {
    w.indent = itemDepth > 0 ? '  '.repeat(listDepth) : ''
  }

  const emitText = (raw: string) => {
    if (skipDepth > 0 || raw === '') return
    let text = decodeEntities(raw)
    if (preDepth > 0) {
      if (preStart && text.startsWith('\n')) text = text.slice(1)
      w.verbatim(text.replaceAll('\u00a0', ' '))
      return
    }
    text.split(HTML_WS).forEach((part, k) => {
      if (k > 0) w.space()
      if (part !== '') w.word(part.replaceAll('\u00a0', ' '))
    })
  }

  const pop = () => {
    const el = stack.pop()!
    if (el.skip) {
      skipDepth--
      return
    }
    if (skipDepth > 0) return
    if (el.name === 'pre' || el.name === 'listing') preDepth--
    if (LISTS.has(el.name)) listDepth--
    if (el.name === 'li') itemDepth--
    syncIndent()
    if (el.href !== null && opts.linkUrls) {
      const text = w.out.slice(el.mark).trim()
      const bare = el.href.replace(/^mailto:/i, '')
      if (text !== el.href && text !== bare) {
        w.space()
        w.word(`<${el.href}>`)
      }
    }
    w.requestBreak(el.level)
  }

  /** Index of the innermost open element in `names`, or -1 if a boundary comes first. */
  const findOpen = (names: ReadonlySet<string>, boundary: ReadonlySet<string>): number => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const name = stack[k]!.name
      if (names.has(name)) return k
      if (boundary.has(name)) return -1
    }
    return -1
  }

  const closeIfOpen = (names: ReadonlySet<string>, boundary: ReadonlySet<string>) => {
    const k = findOpen(names, boundary)
    if (k !== -1) while (stack.length > k) pop()
  }

  const nearest = (names: ReadonlySet<string>, boundary: ReadonlySet<string>): Open | null =>
    stack[findOpen(names, boundary)] ?? null

  const openTag = (tag: Tag) => {
    const { name, attrs } = tag

    // Implicit closes, so unclosed <li>/<p>/<td> do not nest forever.
    const implicit = Object.hasOwn(IMPLICIT, name) ? IMPLICIT[name] : undefined
    if (implicit !== undefined) closeIfOpen(implicit[0], implicit[1])
    if (CLOSES_P.has(name)) closeIfOpen(P, SCOPE)

    const hidden = SKIP.has(name) || isHidden(attrs, opts)

    if (RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}(?=[\\s/>])`, 'gi')
      close.lastIndex = tag.end
      const m = close.exec(html)
      const contentEnd = m === null ? n : m.index
      if (!hidden) emitText(html.slice(tag.end, contentEnd))
      const gt = m === null ? -1 : html.indexOf('>', m.index)
      return gt === -1 ? n : gt + 1
    }

    if (VOID.has(name)) {
      if (skipDepth > 0 || hidden) return tag.end
      if (name === 'br') w.br()
      else if (name === 'hr') w.requestBreak(1)
      return tag.end
    }

    if (tag.selfClosing) return tag.end

    const el: Open = { name, level: 0, skip: false, counter: 1, cells: 0, href: null, mark: 0 }
    stack.push(el)
    if (hidden) {
      el.skip = true
      skipDepth++
      return tag.end
    }
    if (skipDepth > 0) return tag.end

    if (LISTS.has(name)) {
      el.level = listDepth > 0 ? 1 : 2
      const start = Number.parseInt(attrs.get('start') ?? '', 10)
      if (Number.isFinite(start)) el.counter = start
      listDepth++
    } else if (PARAGRAPH.has(name)) {
      el.level = 2
    } else if (LINE.has(name)) {
      el.level = 1
    }
    w.requestBreak(el.level)

    if (name === 'pre' || name === 'listing') {
      preDepth++
      preStart = true
    } else if (name === 'li') {
      const list = nearest(LISTS, SCOPE)
      const marker = list?.name === 'ol' ? `${list.counter++}. ` : '- '
      w.marker = '  '.repeat(Math.max(0, listDepth - 1)) + marker
      itemDepth++
    } else if (name === 'td' || name === 'th') {
      const row = nearest(TR, TABLE)
      if (row !== null && row.cells++ > 0) w.tab()
    } else if (name === 'a') {
      el.href = usefulHref(attrs.get('href'))
      el.mark = w.out.length
    }
    syncIndent()
    return tag.end
  }

  let i = 0
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      emitText(html.slice(i))
      break
    }
    if (lt > i) {
      emitText(html.slice(i, lt))
      preStart = false
    }
    i = lt

    const next = html[i + 1]
    if (html.startsWith('<!--', i)) {
      // `<!-->` and `<!--->` are complete (empty) comments.
      const end = html.startsWith('>', i + 4)
        ? i + 4
        : html.startsWith('->', i + 4)
          ? i + 5
          : html.indexOf('-->', i + 4)
      i = end === -1 ? n : html[end] === '>' ? end + 1 : end + 3
    } else if (next === '!' || next === '?') {
      const gt = html.indexOf('>', i)
      i = gt === -1 ? n : gt + 1
    } else if (next === '/') {
      TAG_NAME.lastIndex = i + 2
      const m = TAG_NAME.exec(html)
      const gt = html.indexOf('>', i)
      if (m !== null) {
        const name = m[0].toLowerCase()
        const k = stack.findLastIndex((el) => el.name === name)
        if (k !== -1) while (stack.length > k) pop()
      }
      i = gt === -1 ? n : gt + 1
    } else if (next !== undefined && /[a-zA-Z]/.test(next)) {
      const tag = readStartTag(html, i)
      if (tag === null) break
      i = openTag(tag)
      if (tag.name !== 'pre' && tag.name !== 'listing') preStart = false
    } else {
      emitText('<')
      i++
    }
  }

  return w.out
    .replace(/ +$/gm, '')
    .replace(/^\n+|\n+$/g, '')
}
