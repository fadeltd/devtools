import { decode, encode, toWellFormed, type Variant } from './codec.ts'

/**
 * One `key=value` pair, in input order.
 *
 * `value` is null for a bare flag (`?debug`) and `''` for an explicit empty
 * value (`?debug=`). `URLSearchParams` folds both into `''`, but servers do
 * not: Rails, PHP and most flag parsers treat them differently.
 */
export interface QueryRow {
  key: string
  value: string | null
  /** Exactly as it appears in the input, still encoded. */
  rawKey: string
  rawValue: string | null
  /** A bad `%` escape was left as-is while decoding this row. */
  malformed: boolean
  /**
   * Where the segment starts in the query, after any leading `?`. Unique per
   * row, so it doubles as an identity when keys repeat.
   */
  offset: number
}

export interface UrlParts {
  protocol: string
  /** Credentials are reported as present, never echoed into the table. */
  hasUsername: boolean
  hasPassword: boolean
  /** As the URL parser normalised it, so an IDN shows its punycode form. */
  hostname: string
  /** '' when absent or the scheme's default (`:443` on https). */
  port: string
  pathname: string
  /** Including the `#`, or ''. */
  hash: string
}

export type ParsedInput =
  | { kind: 'none' }
  | {
      kind: 'url'
      parts: UrlParts
      /** The raw query, without the `?`. */
      query: string
      rows: QueryRow[]
    }
  | {
      kind: 'query'
      query: string
      /** A trailing `#fragment`, or ''. */
      hash: string
      rows: QueryRow[]
    }

const FORM = { plusAsSpace: true, keepReserved: false, lenient: true } as const

function decodeField(raw: string): { text: string; malformed: boolean } {
  // Lenient never fails; the narrowing keeps the type honest anyway.
  const r = decode(raw, FORM)
  return r.ok ? { text: r.output, malformed: r.skipped > 0 } : { text: raw, malformed: true }
}

/**
 * Splits a query string into rows. A leading `?` is dropped, and empty
 * segments (`a=1&&b=2`) are skipped, as `URLSearchParams` does. Keys and
 * values are decoded as form data (`+` is a space); a bad escape is kept
 * verbatim and flags the row instead of failing the whole parse.
 */
export function parseQuery(query: string): QueryRow[] {
  const q = query.startsWith('?') ? query.slice(1) : query
  const rows: QueryRow[] = []
  if (q === '') return rows
  let offset = 0
  for (const segment of q.split('&')) {
    const start = offset
    offset += segment.length + 1
    if (segment === '') continue
    const eq = segment.indexOf('=')
    const rawKey = eq === -1 ? segment : segment.slice(0, eq)
    const rawValue = eq === -1 ? null : segment.slice(eq + 1)
    const key = decodeField(rawKey)
    const value = rawValue === null ? null : decodeField(rawValue)
    rows.push({
      key: key.text,
      value: value === null ? null : value.text,
      rawKey,
      rawValue,
      malformed: key.malformed || (value?.malformed ?? false),
      offset: start,
    })
  }
  return rows
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

function splitHash(s: string): [before: string, hash: string] {
  const h = s.indexOf('#')
  return h === -1 ? [s, ''] : [s.slice(0, h), s.slice(h)]
}

/**
 * Recognises a full URL, a `?query`, anything with a `?` in it
 * (`example.com/path?a=1`), or a bare `a=1&b`. Everything else is `none`, so
 * the table only appears when there is something to put in it.
 *
 * The query is cut from the input text, not taken from `URL.search`: the
 * parser re-encodes spaces, quotes and non-ASCII, and the raw columns must show
 * what was actually pasted.
 */
export function parseInput(input: string): ParsedInput {
  const s = input.trim()
  if (s === '' || s.includes('\n')) return { kind: 'none' }

  if (SCHEME.test(s)) {
    let url: URL | null = null
    try {
      url = new URL(s)
    } catch {
      // Not a URL after all; fall through to the query heuristics.
    }
    if (url !== null) {
      const [beforeHash] = splitHash(s)
      const q = beforeHash.indexOf('?')
      const query = q === -1 ? '' : beforeHash.slice(q + 1)
      return {
        kind: 'url',
        parts: {
          protocol: url.protocol,
          hasUsername: url.username !== '',
          hasPassword: url.password !== '',
          hostname: url.hostname,
          port: url.port,
          pathname: url.pathname,
          hash: url.hash,
        },
        query,
        rows: parseQuery(query),
      }
    }
  }

  const [beforeHash, hash] = splitHash(s)
  const q = beforeHash.indexOf('?')
  if (q !== -1) {
    const query = beforeHash.slice(q + 1)
    return { kind: 'query', query, hash, rows: parseQuery(query) }
  }
  // A bare query must look like one: an `=` or `&`, and no spaces, or any
  // sentence with an equals sign in it would grow a table.
  if (/[=&]/.test(beforeHash) && !/\s/.test(beforeHash)) {
    return { kind: 'query', query: beforeHash, hash, rows: parseQuery(beforeHash) }
  }
  return { kind: 'none' }
}

/**
 * Serialises rows back into a query string (no leading `?`). A null value
 * writes a bare key, so flags survive the round trip. Lone surrogates become
 * U+FFFD rather than throwing, as `URLSearchParams` does.
 */
export function buildQuery(
  rows: readonly { key: string; value: string | null }[],
  variant: Exclude<Variant, 'uri'> = 'form',
): string {
  const enc = (s: string) => {
    const r = encode(toWellFormed(s), variant)
    return r.ok ? r.output : ''
  }
  return rows.map((r) => (r.value === null ? enc(r.key) : `${enc(r.key)}=${enc(r.value)}`)).join('&')
}
