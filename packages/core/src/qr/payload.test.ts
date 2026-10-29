import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildText, buildUrl, buildWifi, escapeWifi, type WifiInput } from './payload.ts'

/** The inverse of escapeWifi, as a scanner reads a field. */
const unescapeWifi = (s: string) => s.replace(/\\(.)/gs, '$1')

describe('escapeWifi', () => {
  it.each([
    ['home', 'home'],
    ['a;b', 'a\\;b'],
    ['a,b', 'a\\,b'],
    ['a:b', 'a\\:b'],
    ['a"b', 'a\\"b'],
    ['a\\b', 'a\\\\b'],
    // The backslash is escaped once, not again after the others are.
    ['\\;', '\\\\\\;'],
    ['"My;Net,1:2"', '\\"My\\;Net\\,1\\:2\\"'],
    ['café ☕ 🛜', 'café ☕ 🛜'],
    ["it's (5G) & more!", "it's (5G) & more!"],
  ])('%j → %j', (input, expected) => {
    expect(escapeWifi(input)).toBe(expected)
  })

  it('round-trips through a scanner-side unescape', () => {
    fc.assert(fc.property(fc.string(), (s) => unescapeWifi(escapeWifi(s)) === s))
  })

  it('leaves no unescaped reserved character', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        // Strip escape pairs; whatever is left must hold no reserved character.
        return !/[\\;,:"]/.test(escapeWifi(s).replace(/\\./gs, ''))
      }),
    )
  })
})

describe('buildWifi', () => {
  const base: WifiInput = { ssid: 'Home', password: 'correct horse', security: 'WPA', hidden: false }

  it('builds a WPA payload', () => {
    expect(buildWifi(base)).toEqual({ ok: true, payload: 'WIFI:T:WPA;S:Home;P:correct horse;;', warnings: [] })
  })

  it('adds H:true only for a hidden network', () => {
    const r = buildWifi({ ...base, hidden: true })
    expect(r.ok && r.payload).toBe('WIFI:T:WPA;S:Home;P:correct horse;H:true;;')
  })

  it('escapes both the SSID and the password', () => {
    const r = buildWifi({ ...base, ssid: 'Cafe;Bar', password: 'p:a"s,s\\w' })
    expect(r.ok && r.payload).toBe('WIFI:T:WPA;S:Cafe\\;Bar;P:p\\:a\\"s\\,s\\\\w;;')
  })

  it('omits the password for an open network', () => {
    const r = buildWifi({ ...base, security: 'nopass', password: 'ignored' })
    expect(r.ok && r.payload).toBe('WIFI:T:nopass;S:Home;;')
  })

  it('builds a WEP payload', () => {
    const r = buildWifi({ ...base, security: 'WEP', password: 'abcde' })
    expect(r).toEqual({ ok: true, payload: 'WIFI:T:WEP;S:Home;P:abcde;;', warnings: [] })
  })

  it('requires an SSID, and a password unless open', () => {
    expect(buildWifi({ ...base, ssid: '' }).ok).toBe(false)
    expect(buildWifi({ ...base, password: '' }).ok).toBe(false)
    expect(buildWifi({ ...base, security: 'WEP', password: '' }).ok).toBe(false)
    expect(buildWifi({ ...base, security: 'nopass', password: '' }).ok).toBe(true)
  })

  it('warns on a WPA password outside 8..63, but accepts a 64-hex raw key', () => {
    const short = buildWifi({ ...base, password: 'short' })
    expect(short.ok && short.warnings).toHaveLength(1)
    const long = buildWifi({ ...base, password: 'x'.repeat(64) })
    expect(long.ok && long.warnings).toHaveLength(1)
    const raw = buildWifi({ ...base, password: 'a1'.repeat(32) })
    expect(raw.ok && raw.warnings).toEqual([])
  })

  it('warns on a WEP key of the wrong shape', () => {
    const bad = buildWifi({ ...base, security: 'WEP', password: 'abcdef' })
    expect(bad.ok && bad.warnings).toHaveLength(1)
    const hex = buildWifi({ ...base, security: 'WEP', password: '0123456789' })
    expect(hex.ok && hex.warnings).toEqual([])
  })

  it('warns when the SSID is over 32 bytes, counting UTF-8', () => {
    // Eight emoji are eight characters but 32 bytes; nine are 36.
    const fits = buildWifi({ ...base, ssid: '🛜'.repeat(8) })
    expect(fits.ok && fits.warnings).toEqual([])
    const over = buildWifi({ ...base, ssid: '🛜'.repeat(9) })
    expect(over.ok && over.warnings[0]).toMatch(/36 bytes/)
  })
})

describe('buildText', () => {
  it('passes text through untouched, whitespace included', () => {
    expect(buildText('  hi\n')).toEqual({ ok: true, payload: '  hi\n', warnings: [] })
  })

  it('refuses empty text', () => {
    expect(buildText('').ok).toBe(false)
  })
})

describe('buildUrl', () => {
  it('accepts an https URL as typed', () => {
    expect(buildUrl('https://example.com')).toEqual({
      ok: true,
      payload: 'https://example.com',
      warnings: [],
      addedScheme: false,
    })
  })

  it('trims surrounding whitespace', () => {
    const r = buildUrl('  https://example.com/a?b=1  ')
    expect(r.ok && r.payload).toBe('https://example.com/a?b=1')
  })

  it('adds https:// to a bare host', () => {
    expect(buildUrl('example.com/path')).toMatchObject({ ok: true, payload: 'https://example.com/path', addedScheme: true })
  })

  it('treats host:port as a host, not a scheme', () => {
    expect(buildUrl('localhost:3000')).toMatchObject({ payload: 'https://localhost:3000', addedScheme: true })
    expect(buildUrl('example.com:8080/x')).toMatchObject({ payload: 'https://example.com:8080/x', addedScheme: true })
  })

  it('keeps a real scheme followed by digits', () => {
    expect(buildUrl('tel:12345')).toMatchObject({ ok: true, payload: 'tel:12345', addedScheme: false })
  })

  it('warns on non-http(s) schemes', () => {
    const tel = buildUrl('tel:+15551234')
    expect(tel.ok && tel.warnings[0]).toMatch(/Not an http\(s\) URL/)
    const js = buildUrl('javascript:alert(1)')
    expect(js.ok && js.warnings[0]).toMatch(/blocked/)
  })

  it('warns on plain http', () => {
    const r = buildUrl('http://example.com')
    expect(r.ok && r.warnings[0]).toMatch(/unencrypted/)
  })

  it('warns on a dotless public host but not on localhost or IPv6', () => {
    const r = buildUrl('https://intranet/x')
    expect(r.ok && r.warnings[0]).toMatch(/no dot/)
    expect(buildUrl('https://localhost/')).toMatchObject({ warnings: [] })
    expect(buildUrl('https://[::1]/')).toMatchObject({ warnings: [] })
  })

  it('rejects what the URL parser rejects', () => {
    expect(buildUrl('https://exa mple.com').ok).toBe(false)
    expect(buildUrl('').ok).toBe(false)
    expect(buildUrl('   ').ok).toBe(false)
  })
})
