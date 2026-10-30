import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeCompact, encodeCompact, fragmentValue } from './compact.ts'

const OPTS = { maxDecodedBytes: 1_000_000 }

describe('compact encoding', () => {
  it('round-trips any JSON value', async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (value) => {
        const back = await decodeCompact(await encodeCompact(value), OPTS)
        expect(back).toEqual(JSON.parse(JSON.stringify(value)))
      }),
      { numRuns: 100 },
    )
  })

  it('is URL-safe', async () => {
    expect(await encodeCompact({ a: 'ü/+=?#&' })).toMatch(/^1\.[A-Za-z0-9_-]+$/)
  })

  it('returns null for garbage, never throws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (s) => {
        const r = await decodeCompact(s, OPTS)
        // A random string is almost never a valid deflate stream of JSON.
        if (r !== null) expect(s.startsWith('1.')).toBe(true)
      }),
      { numRuns: 200 },
    )
    expect(await decodeCompact('2.abc', OPTS)).toBeNull()
  })

  it('refuses a value that inflates past the cap', async () => {
    const big = await encodeCompact('x'.repeat(50_000))
    expect(await decodeCompact(big, { maxDecodedBytes: 1000 })).toBeNull()
  })

  it('reads a fragment value with or without its key', () => {
    expect(fragmentValue('#p=1.abc', 'p')).toBe('1.abc')
    expect(fragmentValue('1.abc', 'p')).toBe('1.abc')
  })
})
