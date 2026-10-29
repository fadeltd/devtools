/**
 * Auto-fixes for "almost JSON": the JS object literals, JSONP responses and
 * config files people paste expecting them to parse.
 *
 * Each fix is a pure function from text to `TextEdit[]`, so it can be tested on
 * its own and previewed as a diff before anything touches the input. Fixes run
 * as a pipeline -- each one sees the previous one's output -- which is what
 * keeps their edits from ever overlapping, and what makes the counts exact.
 */

export interface TextEdit {
  offset: number
  length: number
  content: string
}

export type FixId =
  | 'bom'
  | 'xssi'
  | 'jsonp'
  | 'comments'
  | 'singleQuotes'
  | 'unquotedKeys'
  | 'trailingCommas'

export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = edits.toSorted((a, b) => a.offset - b.offset)
  let out = ''
  let at = 0
  for (const e of sorted) {
    if (e.offset < at) throw new Error(`Overlapping edit at ${e.offset}`)
    out += text.slice(at, e.offset) + e.content
    at = e.offset + e.length
  }
  return out + text.slice(at)
}

// ---------------------------------------------------------------------------
// Tokenizer: just enough structure to know what is inside a string.

type TokenKind = 'ws' | 'comment' | 'dstring' | 'sstring' | 'punct' | 'word' | 'other'

interface Token {
  kind: TokenKind
  offset: number
  length: number
  /** Strings and block comments: false when the input ended first. */
  closed: boolean
}

const PUNCT = new Set(['{', '}', '[', ']', ':', ','])
const WORD_END = /[\s{}[\]:,"'/()]/

function readString(text: string, start: number, quote: string): { end: number; closed: boolean } {
  let i = start + 1
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\') i += 2
    else if (ch === quote) return { end: i + 1, closed: true }
    // A raw newline ends a runaway string, so one stray quote cannot swallow
    // the rest of the document.
    else if (ch === '\n') return { end: i, closed: false }
    else i++
  }
  return { end: text.length, closed: false }
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const push = (kind: TokenKind, end: number, closed = true) => {
    tokens.push({ kind, offset: i, length: end - i, closed })
    i = end
  }

  while (i < text.length) {
    const ch = text[i]!
    if (/\s/.test(ch)) {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j]!)) j++
      push('ws', j)
    } else if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i)
      push('comment', nl === -1 ? text.length : nl)
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      push('comment', close === -1 ? text.length : close + 2, close !== -1)
    } else if (ch === '"' || ch === "'") {
      const { end, closed } = readString(text, i, ch)
      push(ch === '"' ? 'dstring' : 'sstring', end, closed)
    } else if (PUNCT.has(ch)) {
      push('punct', i + 1)
    } else if (WORD_END.test(ch)) {
      push('other', i + 1)
    } else {
      let j = i + 1
      while (j < text.length && !WORD_END.test(text[j]!)) j++
      push('word', j)
    }
  }
  return tokens
}

function isTrivia(t: Token): boolean {
  return t.kind === 'ws' || t.kind === 'comment'
}

function significantNeighbour(tokens: readonly Token[], from: number, step: 1 | -1): Token | undefined {
  for (let i = from + step; i >= 0 && i < tokens.length; i += step) {
    if (!isTrivia(tokens[i]!)) return tokens[i]
  }
  return undefined
}

function tokenText(text: string, t: Token): string {
  return text.slice(t.offset, t.offset + t.length)
}

// ---------------------------------------------------------------------------
// The fixes.

export function fixBom(text: string): TextEdit[] {
  return text.startsWith('﻿') ? [{ offset: 0, length: 1, content: '' }] : []
}

/**
 * The anti-JSON-hijacking prefix Google and Angular APIs send: `)]}'` on its
 * own line, sometimes followed by a comma.
 */
export function fixXssi(text: string): TextEdit[] {
  const m = /^\s*\)\]\}'[ \t]*,?[ \t]*(\r?\n)?/.exec(text)
  return m === null ? [] : [{ offset: 0, length: m[0].length, content: '' }]
}

/** `callback({...});` -- including the `/**\/` some servers prepend. */
export function fixJsonp(text: string): TextEdit[] {
  const head = /^\s*(?:\/\*\*\/\s*)?[A-Za-z_$][\w$.]*\s*\(\s*/.exec(text)
  if (head === null) return []
  const tail = /\s*\)\s*;?\s*$/.exec(text)
  if (tail === null || tail.index < head[0].length) return []
  const inner = text.slice(head[0].length, tail.index)
  if (!/^[{[]/.test(inner)) return []
  return [
    { offset: 0, length: head[0].length, content: '' },
    { offset: tail.index, length: tail[0].length, content: '' },
  ]
}

/**
 * A comment alone on its line takes the line with it, so the fixed text does
 * not keep a whitespace-only line where each one was.
 */
export function fixComments(text: string): TextEdit[] {
  const edits: TextEdit[] = []
  for (const t of tokenize(text)) {
    if (t.kind !== 'comment') continue
    const lineStart = text.lastIndexOf('\n', t.offset - 1) + 1
    const end = t.offset + t.length
    // Sticky, so the match starts at `end` without copying the rest of the text.
    const rest = /[ \t]*\r?\n/y
    rest.lastIndex = end
    const nl = rest.exec(text)
    const alone = /^[ \t]*$/.test(text.slice(lineStart, t.offset)) && nl !== null
    edits.push(
      alone
        ? { offset: lineStart, length: end + nl[0].length - lineStart, content: '' }
        : { offset: t.offset, length: t.length, content: '' },
    )
  }
  return edits
}

/** Re-quote `'…'` as `"…"`: unescape `\'`, escape bare `"`. */
export function fixSingleQuotes(text: string): TextEdit[] {
  const edits: TextEdit[] = []
  for (const t of tokenize(text)) {
    if (t.kind !== 'sstring' || !t.closed) continue
    const body = text.slice(t.offset + 1, t.offset + t.length - 1)
    let out = ''
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!
      if (ch === '\\') {
        const next = body[i + 1] ?? ''
        out += next === "'" ? "'" : `\\${next}`
        i++
      } else if (ch === '"') {
        out += '\\"'
      } else {
        out += ch
      }
    }
    edits.push({ offset: t.offset, length: t.length, content: `"${out}"` })
  }
  return edits
}

const KEY_WORD = /^[A-Za-z0-9_$]+$/

/** `{ foo: 1 }` → `{ "foo": 1 }`: a bare word in key position before a colon. */
export function fixUnquotedKeys(text: string): TextEdit[] {
  const tokens = tokenize(text)
  const edits: TextEdit[] = []
  for (const [i, t] of tokens.entries()) {
    if (t.kind !== 'word') continue
    const word = tokenText(text, t)
    if (!KEY_WORD.test(word)) continue
    const prev = significantNeighbour(tokens, i, -1)
    const next = significantNeighbour(tokens, i, 1)
    if (prev?.kind !== 'punct' || next?.kind !== 'punct') continue
    const before = tokenText(text, prev)
    if ((before !== '{' && before !== ',') || tokenText(text, next) !== ':') continue
    edits.push({ offset: t.offset, length: t.length, content: `"${word}"` })
  }
  return edits
}

export function fixTrailingCommas(text: string): TextEdit[] {
  const tokens = tokenize(text)
  const edits: TextEdit[] = []
  for (const [i, t] of tokens.entries()) {
    if (t.kind !== 'punct' || tokenText(text, t) !== ',') continue
    const next = significantNeighbour(tokens, i, 1)
    if (next === undefined || next.kind !== 'punct') continue
    const close = tokenText(text, next)
    if (close === '}' || close === ']') edits.push({ offset: t.offset, length: 1, content: '' })
  }
  return edits
}

// ---------------------------------------------------------------------------
// The pipeline.

interface FixDef {
  id: FixId
  find: (text: string) => TextEdit[]
  label: (count: number) => string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Order matters: wrappers come off first so the tokenizer sees the document,
 * comments go before trailing commas so `1, // note\n}` is caught, and quotes
 * are normalised before keys so `'a': 1` is not also treated as a bare word.
 */
export const FIXES: readonly FixDef[] = [
  { id: 'bom', find: fixBom, label: () => 'Remove byte-order mark' },
  { id: 'xssi', find: fixXssi, label: () => "Strip )]}' prefix" },
  { id: 'jsonp', find: fixJsonp, label: () => 'Strip JSONP wrapper' },
  { id: 'comments', find: fixComments, label: (n) => `Remove ${plural(n, 'comment')}` },
  {
    id: 'singleQuotes',
    find: fixSingleQuotes,
    label: (n) => `Convert ${plural(n, 'single-quoted string')}`,
  },
  { id: 'unquotedKeys', find: fixUnquotedKeys, label: (n) => `Quote ${plural(n, 'bare key')}` },
  {
    id: 'trailingCommas',
    find: fixTrailingCommas,
    label: (n) => `Remove ${plural(n, 'trailing comma')}`,
  },
]

export interface FoundFix {
  id: FixId
  count: number
  label: string
}

export interface FixResult {
  text: string
  applied: FoundFix[]
}

/** Run every fix in order; report the ones that changed something. */
export function runFixes(text: string): FixResult {
  let current = text
  const applied: FoundFix[] = []
  for (const fix of FIXES) {
    const edits = fix.find(current)
    if (edits.length === 0) continue
    // Wrapper fixes emit two edits for one change; count changes, not edits.
    const count = fix.id === 'jsonp' ? 1 : edits.length
    applied.push({ id: fix.id, count, label: fix.label(count) })
    current = applyEdits(current, edits)
  }
  return { text: current, applied }
}
