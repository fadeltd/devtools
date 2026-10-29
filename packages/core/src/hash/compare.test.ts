import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { matchDigest, parseDigestString, timingSafeEqual } from './compare.ts'
import { digestAll, formatDigest, toHex } from './digest.ts'

describe('timingSafeEqual', () => {
  it('is plain byte equality', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), fc.uint8Array({ maxLength: 64 }), (a, b) => {
        const same = a.length === b.length && a.every((x, i) => x === b[i])
        expect(timingSafeEqual(a, b)).toBe(same)
        expect(timingSafeEqual(a, a.slice())).toBe(true)
      }),
    )
  })

  it('treats different lengths as unequal', () => {
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false)
  })
})

function bytes(s: string): string {
  const r = parseDigestString(s)
  return r.ok ? toHex(r.bytes) : `error: ${r.message}`
}

describe('parseDigestString', () => {
  const sha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

  it('normalises hex case, whitespace and labels', () => {
    for (const s of [
      sha256,
      sha256.toUpperCase(),
      `  ${sha256}\n`,
      sha256.replace(/(.{8})/g, '$1 '),
      `sha256=${sha256}`,
      `SHA256:${sha256}`,
      `sha-256:${sha256}`,
      `v1=${sha256}`,
    ]) {
      expect(bytes(s), s).toBe(sha256)
    }
  })

  it('takes the hash from sha256sum output', () => {
    expect(bytes(`${sha256}  -`)).toBe(sha256)
    expect(bytes(`${sha256}  my file.txt`)).toBe(sha256)
  })

  it('decodes base64, base64url and SRI forms', () => {
    const raw = Buffer.from(sha256, 'hex')
    expect(bytes(raw.toString('base64'))).toBe(sha256)
    expect(bytes(raw.toString('base64url'))).toBe(sha256)
    expect(bytes(`sha256-${raw.toString('base64')}`)).toBe(sha256)
  })

  it('reports garbage instead of throwing', () => {
    expect(parseDigestString('not a hash!').ok).toBe(false)
    expect(parseDigestString('').ok).toBe(false)
  })
})

describe('matchDigest', () => {
  it('names the algorithm whose digest was pasted, in any format', async () => {
    const all = await digestAll('abc')
    expect(matchDigest(toHex(all['SHA-1']), all)).toEqual({ status: 'match', algorithm: 'SHA-1' })
    expect(matchDigest(formatDigest(all['SHA-384'], 'base64'), all)).toEqual({
      status: 'match',
      algorithm: 'SHA-384',
    })
    expect(matchDigest(formatDigest(all['SHA-512'], 'HEX'), all)).toEqual({
      status: 'match',
      algorithm: 'SHA-512',
    })
  })

  it('says none matched for the hash of a different input', async () => {
    const all = await digestAll('abc')
    const other = await digestAll('abc\n')
    expect(matchDigest(toHex(other['SHA-256']), all)).toEqual({ status: 'none' })
  })

  it('reports invalid text', async () => {
    expect(matchDigest('xyz!', await digestAll('abc')).status).toBe('invalid')
  })
})
