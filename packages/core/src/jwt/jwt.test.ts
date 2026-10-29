import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bytesToBase64 } from '../base64/codec.ts'
import { losslessSupported } from '../json/rawjson.ts'
import { checkClaims, decodeJwt, formatRelative, type JwtResult } from './claims.ts'
import { encodeJsonSegment as seg, exampleToken } from './example.ts'
import { lossyIntegers, parseJwt } from './parse.ts'

const NOW = Date.UTC(2026, 0, 1) // 2026-01-01T00:00:00Z
const T = NOW / 1000

const b64url = (bytes: Uint8Array) => bytesToBase64(bytes, { alphabet: 'base64url', padding: false })
const textSeg = (s: string) => b64url(new TextEncoder().encode(s))
const SIG = b64url(Uint8Array.from({ length: 32 }, (_, i) => 255 - i))

const HS256 = { alg: 'HS256', typ: 'JWT' }
const jws = (payload: unknown, header: unknown = HS256, sig = SIG) => `${seg(header)}.${seg(payload)}.${sig}`
const decode = (input: string, skew = 0) => decodeJwt(input, { now: NOW, clockSkewSeconds: skew })
const messages = (r: { warnings: { message: string }[] }) => r.warnings.map((w) => w.message).join('\n')

describe('a known token', () => {
  // Hand-built so the expected base64url is pinned, not derived from our encoder.
  const token =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
    '.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJpYXQiOjE3NjcyMjU2MDAsImV4cCI6MTc2NzIyOTIwMH0' +
    '.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

  it('decodes header, payload and signature', () => {
    const r = decode(token)
    expect(r.errors).toEqual([])
    expect(r.kind).toBe('jws')
    expect(r.header?.value).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(r.payload?.value).toEqual({ sub: 'test-user', iat: 1767225600, exp: 1767229200 })
    expect(r.signature).toEqual({ bytes: 32, base64url: token.split('.')[2], verified: false })
  })

  it('pretty-prints the JSON', () => {
    expect(decode(token).header?.pretty).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}')
  })

  it('reports the claims with dates and offsets', () => {
    const r = decode(token)
    expect(r.status).toBe('valid')
    const exp = r.claims.find((c) => c.name === 'exp')
    expect(exp?.time?.iso).toBe('2026-01-01T01:00:00.000Z')
    expect(exp?.time?.relativeSeconds).toBe(3600)
    expect(exp?.time?.relative).toBe('in 1 h')
    expect(r.claims.map((c) => c.name)).toEqual(['sub', 'exp', 'iat'])
  })

  it('records where each segment starts', () => {
    const r = decode(token)
    expect(r.parts.map((p) => p.name)).toEqual(['header', 'payload', 'signature'])
    for (const p of r.parts) expect(r.token.slice(p.start, p.start + p.text.length)).toBe(p.text)
  })
})

describe('input normalisation', () => {
  const token = jws({ sub: 'a', exp: T + 60 })

  it.each([
    ['Bearer prefix', `Bearer ${token}`],
    ['lowercase bearer', `bearer ${token}`],
    ['Authorization header line', `Authorization: Bearer ${token}`],
    ['surrounding whitespace', `\n  ${token}  \n`],
    ['double quotes', `"${token}"`],
    ['single quotes', `'${token}'`],
  ])('accepts %s', (_, input) => {
    const r = decode(input)
    expect(r.token).toBe(token)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('removes line wraps inside the token, and says so', () => {
    const r = decode(`${token.slice(0, 20)}\n${token.slice(20)}`)
    expect(r.token).toBe(token)
    expect(r.errors).toEqual([])
    expect(messages(r)).toMatch(/whitespace/)
  })

  it('treats empty and blank input as nothing to report', () => {
    for (const input of ['', '   \n']) {
      const r = decode(input)
      expect(r.token).toBe('')
      expect(r.errors).toEqual([])
      expect(r.warnings).toEqual([])
      expect(r.status).toBeNull()
    }
  })
})

describe('structure', () => {
  it('rejects a string with no dots', () => {
    const r = decode('hello')
    expect(r.kind).toBeNull()
    expect(r.errors[0]?.message).toMatch(/no dots/)
  })

  it('hints at a missing signature for two segments', () => {
    const r = decode(`${seg(HS256)}.${seg({})}`)
    expect(r.errors[0]?.message).toMatch(/found 2.*signature missing/)
  })

  it('rejects four segments', () => {
    expect(decode('a.b.c.d').errors[0]?.message).toMatch(/found 4/)
  })

  it('reports an empty header by name', () => {
    const r = decode(`.${seg({})}.${SIG}`)
    expect(r.errors).toEqual([{ segment: 'header', message: 'Header is empty.', position: 0 }])
  })
})

describe('JWE', () => {
  const header = { alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'JWT' }
  const token = [seg(header), b64url(new Uint8Array(256)), b64url(new Uint8Array(12)), b64url(new Uint8Array(40)), b64url(new Uint8Array(16))].join('.')

  it('decodes only the header and reports the encrypted sizes', () => {
    const r = decode(token)
    expect(r.kind).toBe('jwe')
    expect(r.errors).toEqual([])
    expect(r.header?.value).toEqual(header)
    expect(r.payload).toBeNull()
    expect(r.signature).toBeNull()
    expect(r.status).toBeNull()
    expect(r.claims).toEqual([])
    expect(r.encrypted).toEqual([
      { name: 'encrypted key', bytes: 256 },
      { name: 'iv', bytes: 12 },
      { name: 'ciphertext', bytes: 40 },
      { name: 'tag', bytes: 16 },
    ])
  })

  it('accepts the empty encrypted key of alg "dir"', () => {
    const r = decode([seg({ alg: 'dir', enc: 'A128GCM' }), '', b64url(new Uint8Array(12)), 'AAAA', b64url(new Uint8Array(16))].join('.'))
    expect(r.errors).toEqual([])
    expect(r.encrypted?.[0]).toEqual({ name: 'encrypted key', bytes: 0 })
  })

  it('warns when a JWE header has no enc, or a signing alg', () => {
    const r = decode([seg({ alg: 'HS256' }), '', 'AAAA', 'AAAA', 'AAAA'].join('.'))
    expect(messages(r)).toMatch(/must name its content encryption in "enc"/)
    expect(messages(r)).toMatch(/"HS256" is a signing algorithm/)
  })
})

describe('bad base64url', () => {
  it('points at the first character outside the alphabet', () => {
    const header = seg(HS256)
    const payload = seg({ sub: 'x' })
    const bad = `${payload.slice(0, 3)}!${payload.slice(4)}`
    const r = decode(`${header}.${bad}.${SIG}`)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatchObject({ segment: 'payload', position: header.length + 1 + 3 })
    expect(r.errors[0]?.message).toMatch(/"!" at character \d+ is not a base64url character/)
    expect(r.payload).toBeNull()
    // The other segments still decode.
    expect(r.header?.ok).toBe(true)
    expect(r.signature?.bytes).toBe(32)
  })

  it('names standard base64 when it sees + or /', () => {
    const r = decode(`${seg(HS256)}.${seg({})}.ab+/`)
    expect(r.errors[0]).toMatchObject({ segment: 'signature' })
    expect(r.errors[0]?.message).toMatch(/standard base64/)
  })

  it('reports an impossible length as truncated', () => {
    // 5 characters: 1 more than a whole 4-character group, which no byte count encodes.
    expect(decode(`${seg(HS256)}.abcde.${SIG}`).errors[0]?.message).toMatch(/Payload is truncated/)
  })

  it('tolerates padding, with a warning', () => {
    const header = seg({ alg: 'HS256', kid: 'k' }) // 25 bytes: 34 characters, so 2 of padding
    expect(header.length % 4).toBe(2)
    const r = decode(`${header}==.${seg({ exp: T + 1 })}.${SIG}`)
    expect(r.errors).toEqual([])
    expect(r.header?.value).toEqual({ alg: 'HS256', kid: 'k' })
    expect(r.warnings).toEqual([
      expect.objectContaining({ segment: 'header', position: 34, message: expect.stringMatching(/padded with "="/) }),
    ])
  })

  it('rejects = in the middle of a segment', () => {
    const r = decode(`${seg(HS256)}.ab=cd.${SIG}`)
    expect(r.errors[0]?.message).toMatch(/"=" at character/)
  })

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const r = decode(s)
        expect(Array.isArray(r.errors)).toBe(true)
      }),
    )
  })

  it('never throws on arbitrary dotted base64url-ish input', () => {
    const chunk = fc.stringMatching(/^[A-Za-z0-9_=+/-]{0,40}$/)
    fc.assert(
      fc.property(fc.array(chunk, { minLength: 1, maxLength: 6 }), (chunks) => {
        const r = decode(chunks.join('.'))
        expect(Array.isArray(r.warnings)).toBe(true)
      }),
    )
  })
})

describe('segment contents', () => {
  it('reports a non-JSON payload, keeping the text', () => {
    const r = decode(`${seg(HS256)}.${textSeg('hello, world')}.${SIG}`)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]?.segment).toBe('payload')
    expect(r.errors[0]?.message).toMatch(/^Payload is not valid JSON/)
    expect(r.payload).toMatchObject({ ok: false, text: 'hello, world', pretty: 'hello, world' })
    expect(r.status).toBeNull()
  })

  it('reports invalid UTF-8 rather than decoding to replacement characters', () => {
    const r = decode(`${seg(HS256)}.${b64url(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))}.${SIG}`)
    expect(r.errors[0]?.message).toMatch(/not valid UTF-8/)
    expect(r.payload?.text).toBeNull()
  })

  it('decodes non-ASCII claims', () => {
    const r = decode(jws({ name: 'Zoë 日本 🎉', exp: T + 1 }))
    expect(r.payload?.value).toEqual({ name: 'Zoë 日本 🎉', exp: T + 1 })
  })

  it('errors when the header is not an object', () => {
    const r = decode(`${seg([1, 2])}.${seg({})}.${SIG}`)
    expect(r.errors[0]).toMatchObject({ segment: 'header', message: 'Header is valid JSON, but not an object.' })
  })

  it('warns when the payload is JSON but not an object', () => {
    const r = decode(jws('just a string'))
    expect(r.errors).toEqual([])
    expect(messages(r)).toMatch(/not an object/)
    expect(r.status).toBeNull()
  })
})

describe('large numbers', () => {
  it('flags an integer a double cannot hold, but not 2^53', () => {
    expect(lossyIntegers('{"a":12345678901234567890}')).toEqual(['12345678901234567890'])
    expect(lossyIntegers('{"a":9007199254740992}')).toEqual([])
    expect(lossyIntegers('{"a":9007199254740993}')).toEqual(['9007199254740993'])
  })

  it('ignores digits inside strings, including keys and escaped quotes', () => {
    expect(lossyIntegers('{"12345678901234567890":"12345678901234567891","b":"x\\"12345678901234567892"}')).toEqual([])
  })

  it('reports each distinct literal once', () => {
    expect(lossyIntegers('[12345678901234567890,12345678901234567890]')).toEqual(['12345678901234567890'])
  })

  it('flags a literal too large to be finite', () => {
    expect(lossyIntegers(`[${'9'.repeat(400)}]`)).toHaveLength(1)
  })

  it('warns, and keeps the digits when the runtime can', () => {
    const header = seg(HS256)
    const payload = textSeg('{"id":12345678901234567890,"exp":1767229200}')
    const r = decode(`${header}.${payload}.${SIG}`)
    expect(messages(r)).toMatch(/12345678901234567890 is too large/)
    if (losslessSupported) expect(r.payload?.pretty).toContain('12345678901234567890')
    expect(r.status).toBe('valid')
  })

  it('still reads a time claim written in a reformatted literal', () => {
    const r = decode(`${seg(HS256)}.${textSeg('{"exp":1.7672292e9}')}.${SIG}`)
    expect(r.claims[0]?.time?.seconds).toBe(1767229200)
  })
})

const status = (payload: Record<string, unknown>, skew = 0) =>
  checkClaims(payload, { now: NOW, clockSkewSeconds: skew }).status
const claimWarnings = (payload: Record<string, unknown>) => messages(checkClaims(payload, { now: NOW }))
const headerWarnings = (header: unknown, sig = SIG) => messages(decode(jws({ exp: T + 1 }, header, sig)))

describe('expiry and skew', () => {
  it('expires exactly at exp: now must be before it', () => {
    expect(status({ exp: T + 1 })).toBe('valid')
    expect(status({ exp: T })).toBe('expired')
    expect(status({ exp: T - 1 })).toBe('expired')
  })

  it('extends exp by the skew', () => {
    expect(status({ exp: T - 59 }, 60)).toBe('valid')
    expect(status({ exp: T - 60 }, 60)).toBe('expired')
  })

  it('is valid from nbf onwards', () => {
    expect(status({ exp: T + 100, nbf: T })).toBe('valid')
    expect(status({ exp: T + 100, nbf: T + 1 })).toBe('not-yet-valid')
  })

  it('pulls nbf earlier by the skew', () => {
    expect(status({ exp: T + 100, nbf: T + 60 }, 60)).toBe('valid')
    expect(status({ exp: T + 100, nbf: T + 61 }, 60)).toBe('not-yet-valid')
  })

  it('reports no expiry, and warns about it', () => {
    const r = checkClaims({ sub: 'x' }, { now: NOW })
    expect(r.status).toBe('no-expiry')
    expect(messages(r)).toMatch(/no "exp" claim/)
  })

  it('treats a non-numeric exp as a warning and an unknown status, not a crash', () => {
    const r = checkClaims({ exp: '1767229200' }, { now: NOW })
    expect(r.status).toBe('unknown')
    expect(messages(r)).toMatch(/"exp" is the string "1767229200", not a NumericDate/)
    expect(r.claims[0]).toMatchObject({ name: 'exp', display: '1767229200', time: null })
  })

  it('warns about a non-numeric iat without affecting the status', () => {
    const r = checkClaims({ exp: T + 10, iat: null }, { now: NOW })
    expect(r.status).toBe('valid')
    expect(messages(r)).toMatch(/"iat" is null/)
  })

  it('accepts fractional NumericDates', () => {
    expect(status({ exp: T + 0.5 })).toBe('valid')
  })

  it('treats a negative skew as zero', () => {
    expect(status({ exp: T + 1 }, -100)).toBe('valid')
  })
})

describe('claim warnings', () => {
  const warn = claimWarnings

  it('flags milliseconds', () => {
    expect(warn({ exp: NOW + 3_600_000 })).toMatch(/"exp" looks like milliseconds/)
  })

  it('flags an exp more than ten years away', () => {
    expect(warn({ exp: T + 11 * 365 * 86_400 })).toMatch(/"exp" is 11 y away/)
    expect(warn({ exp: T + 9 * 365 * 86_400 })).not.toMatch(/away/)
  })

  it('flags an iat in the future, beyond the skew', () => {
    expect(warn({ exp: T + 100, iat: T + 30 })).toMatch(/issued in the future/)
    expect(messages(checkClaims({ exp: T + 100, iat: T + 30 }, { now: NOW, clockSkewSeconds: 60 }))).not.toMatch(/future/)
  })

  it('flags exp before iat', () => {
    expect(warn({ exp: T - 100, iat: T - 50 })).toMatch(/expired before it was issued/)
  })

  it('flags ill-typed string claims', () => {
    expect(warn({ exp: T + 1, sub: 42 })).toMatch(/"sub" should be a string, but it is a number/)
    expect(warn({ exp: T + 1, aud: ['a', 1] })).toMatch(/"aud" should be a string or an array of strings/)
    expect(warn({ exp: T + 1, aud: ['a', 'b'] })).toBe('')
  })

  it('displays an audience array joined', () => {
    const r = checkClaims({ aud: ['api', 'web'], exp: T + 1 }, { now: NOW })
    expect(r.claims.find((c) => c.name === 'aud')?.display).toBe('api, web')
  })

  it('returns no ISO date beyond what Date can hold, without throwing', () => {
    const r = checkClaims({ exp: 1e20 }, { now: NOW })
    expect(r.claims[0]?.time?.iso).toBeNull()
  })
})

describe('header warnings', () => {
  const warn = headerWarnings

  it('flags alg none', () => {
    expect(warn({ alg: 'none' }, '')).toMatch(/"alg" is "none": the token is unsigned/)
  })

  it('flags odd casings of none', () => {
    expect(warn({ alg: 'nOnE' }, '')).toMatch(/Odd casings/)
  })

  it('flags alg none with a signature attached', () => {
    expect(warn({ alg: 'none' })).toMatch(/yet the token carries a signature/)
  })

  it('flags a signed alg with an empty signature', () => {
    expect(warn(HS256, '')).toMatch(/signature is empty/)
  })

  it('flags a missing alg', () => {
    expect(warn({ typ: 'JWT' })).toMatch(/no "alg"/)
  })

  it('flags an encryption alg on a signed-shape token', () => {
    expect(warn({ alg: 'RSA-OAEP', typ: 'JWT' })).toMatch(/key-management algorithm/)
  })

  it('flags a typ that is not a JWT type', () => {
    expect(warn({ alg: 'HS256', typ: 'JWE' })).toMatch(/"typ" is "JWE"/)
  })

  it.each(['JWT', 'jwt', 'at+jwt', 'application/secevent+jwt', 'JOSE', 'dpop+jwt'])('accepts typ %s', (typ) => {
    expect(warn({ alg: 'ES256', typ })).toBe('')
  })
})

describe('formatRelative', () => {
  it.each([
    [0, 'now'],
    [0.4, 'now'],
    [1, 'in 1 s'],
    [-45, '45 s ago'],
    [3600, 'in 1 h'],
    [3725, 'in 1 h 2 min'],
    [-90061, '1 d 1 h ago'],
    [400 * 86_400, 'in 1 y 35 d'],
  ])('%d → %s', (s, text) => {
    expect(formatRelative(s)).toBe(text)
  })
})

describe('exampleToken', () => {
  it('decodes cleanly and is valid for an hour', () => {
    const r: JwtResult = decode(exampleToken(NOW))
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.status).toBe('valid')
    expect(r.signature?.bytes).toBe(32)
    expect(r.claims.map((c) => c.name)).toEqual(['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'])
  })

  it('round-trips any JSON object payload', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean())), (payload) => {
        const r = parseJwt(jws(payload))
        expect(r.errors).toEqual([])
        expect(r.payload?.value).toEqual(payload)
      }),
    )
  })
})
