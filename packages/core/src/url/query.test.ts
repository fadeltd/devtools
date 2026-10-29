import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildQuery, parseInput, parseQuery } from './query.ts'

describe('parseQuery', () => {
  it('keeps duplicate keys, in order', () => {
    expect(parseQuery('a=1&b=2&a=3').map((r) => [r.key, r.value])).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['a', '3'],
    ])
  })

  it('tells a flag from an empty value', () => {
    const [flag, empty] = parseQuery('debug&verbose=')
    expect(flag).toMatchObject({ key: 'debug', value: null, rawKey: 'debug', rawValue: null })
    expect(empty).toMatchObject({ key: 'verbose', value: '', rawKey: 'verbose', rawValue: '' })
  })

  it('decodes as form data and keeps the raw text', () => {
    const [row] = parseQuery('?q=caf%C3%A9+au+lait&x')
    expect(row).toMatchObject({ key: 'q', value: 'café au lait', rawValue: 'caf%C3%A9+au+lait', malformed: false })
  })

  it('splits on the first = only', () => {
    expect(parseQuery('token=a=b==')[0]).toMatchObject({ key: 'token', value: 'a=b==' })
    expect(parseQuery('=x')[0]).toMatchObject({ key: '', value: 'x' })
  })

  it('skips empty segments as URLSearchParams does', () => {
    expect(parseQuery('&&a=1&&b&').map((r) => r.offset)).toEqual([2, 7])
    expect(parseQuery('?x=1&y').map((r) => r.offset)).toEqual([0, 4])
    expect(parseQuery('')).toEqual([])
    expect(parseQuery('?')).toEqual([])
  })

  it('flags a malformed row instead of failing the parse', () => {
    const rows = parseQuery('ok=1&bad=%E2%82&pct=100%')
    expect(rows.map((r) => r.malformed)).toEqual([false, true, true])
    expect(rows[1]?.value).toBe('%E2%82')
    expect(rows[2]?.value).toBe('100%')
  })

  it('agrees with URLSearchParams on keys and values', () => {
    const part = fc.string({
      unit: fc.constantFrom('a', 'é', '😀', ' ', '+', '=', '%20', '%2B', '%3D', '%26', 'x'),
      maxLength: 6,
    })
    fc.assert(
      fc.property(fc.array(fc.tuple(part, part), { maxLength: 5 }), (pairs) => {
        const q = pairs.map(([k, v]) => `${k.replaceAll('=', '%3D')}=${v}`).join('&')
        const ours = parseQuery(q).map((r) => [r.key, r.value ?? ''])
        return JSON.stringify(ours) === JSON.stringify([...new URLSearchParams(q)])
      }),
    )
  })
})

describe('buildQuery', () => {
  it('writes flags as bare keys and encodes as form data', () => {
    expect(
      buildQuery([
        { key: 'q', value: 'a b&c' },
        { key: 'debug', value: null },
        { key: 'empty', value: '' },
      ]),
    ).toBe('q=a+b%26c&debug&empty=')
  })

  it('can use %20 instead of +', () => {
    expect(buildQuery([{ key: 'q', value: 'a b' }], 'component')).toBe('q=a%20b')
  })

  it('round-trips through parseQuery, flags and duplicates included', () => {
    const row = fc.record({
      key: fc.string({ unit: 'binary', maxLength: 8 }),
      value: fc.option(fc.string({ unit: 'binary', maxLength: 8 }), { nil: null }),
    })
    fc.assert(
      fc.property(fc.array(row, { maxLength: 6 }), (rows) => {
        // An empty bare key writes an empty segment, which parsing drops.
        const kept = rows.filter((r) => !(r.key === '' && r.value === null))
        const back = parseQuery(buildQuery(rows)).map(({ key, value }) => ({ key, value }))
        return JSON.stringify(back) === JSON.stringify(kept)
      }),
    )
  })

  it('does not throw on a lone surrogate', () => {
    expect(buildQuery([{ key: 'a', value: '\uD800' }])).toBe('a=%EF%BF%BD')
  })
})

describe('parseInput', () => {
  it('parses a full URL into parts and rows', () => {
    const r = parseInput('  https://user:pw@例え.jp:8443/a%20b/c?x=1&y=two+words&flag#frag ')
    expect(r.kind).toBe('url')
    if (r.kind !== 'url') return
    expect(r.parts).toEqual({
      protocol: 'https:',
      hasUsername: true,
      hasPassword: true,
      hostname: 'xn--r8jz45g.jp',
      port: '8443',
      pathname: '/a%20b/c',
      hash: '#frag',
    })
    expect(r.query).toBe('x=1&y=two+words&flag')
    expect(r.rows.map((row) => row.value)).toEqual(['1', 'two words', null])
  })

  it('takes the raw query from the input, not the re-encoded URL.search', () => {
    const r = parseInput('https://x.dev/?q=a b&é=1')
    expect(r.kind === 'url' && r.query).toBe('q=a b&é=1')
    expect(r.kind === 'url' && r.rows[1]?.rawKey).toBe('é')
  })

  it('reports a default port as empty and no credentials as absent', () => {
    const r = parseInput('https://x.dev:443/')
    expect(r.kind === 'url' && r.parts).toMatchObject({ port: '', hasUsername: false, hasPassword: false })
  })

  it('does not mistake a ? inside the fragment for a query', () => {
    const r = parseInput('https://x.dev/#/route?tab=2')
    expect(r.kind === 'url' && r.rows).toEqual([])
  })

  it('accepts a ?query and a schemeless URL', () => {
    expect(parseInput('?a=1&b').kind).toBe('query')
    const r = parseInput('example.com/search?q=1#top')
    expect(r).toMatchObject({ kind: 'query', query: 'q=1', hash: '#top' })
  })

  it('accepts a bare query', () => {
    const r = parseInput('a=1&b&a=2')
    expect(r.kind === 'query' && r.rows.map((row) => row.key)).toEqual(['a', 'b', 'a'])
  })

  it('declines prose, multi-line text and empty input', () => {
    expect(parseInput('').kind).toBe('none')
    expect(parseInput('hello world').kind).toBe('none')
    expect(parseInput('x = 1 & y = 2').kind).toBe('none')
    expect(parseInput('a=1\nb=2').kind).toBe('none')
    expect(parseInput('just-a-word').kind).toBe('none')
  })
})
