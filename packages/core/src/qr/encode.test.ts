import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CAPACITY, ECC_LEVELS, detectMode, encodeQr, type QrCode, type QrMode } from './encode.ts'

function ok(result: ReturnType<typeof encodeQr>): QrCode {
  if (!result.ok) throw new Error(result.message)
  return result
}

/** A 7x7 finder: dark ring, light ring, dark 3x3 centre. */
function hasFinder(matrix: boolean[][], top: number, left: number): boolean {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dy - 3), Math.abs(dx - 3))
      if (matrix[top + dy]![left + dx] !== (ring !== 2)) return false
    }
  }
  return true
}

describe('encodeQr: shape', () => {
  it('is square, sized 17 + 4v + 2·border', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 300 }).filter((s) => !/[\uD800-\uDFFF]/u.test(s)),
        fc.constantFrom(...ECC_LEVELS),
        fc.integer({ min: 0, max: 8 }),
        (text, ecc, border) => {
          const qr = ok(encodeQr(text, { ecc, border }))
          expect(qr.size).toBe(17 + 4 * qr.version + 2 * border)
          expect(qr.modules).toBe(17 + 4 * qr.version)
          expect(qr.matrix).toHaveLength(qr.size)
          for (const row of qr.matrix) expect(row).toHaveLength(qr.size)
        },
      ),
      { numRuns: 60 },
    )
  })

  it('has finder patterns in three corners and not the fourth', () => {
    const qr = ok(encodeQr('https://devtools.fadeltd.dev/qr', { ecc: 'M', border: 4 }))
    const far = qr.size - qr.border - 7
    expect(hasFinder(qr.matrix, qr.border, qr.border)).toBe(true)
    expect(hasFinder(qr.matrix, qr.border, far)).toBe(true)
    expect(hasFinder(qr.matrix, far, qr.border)).toBe(true)
    expect(hasFinder(qr.matrix, far, far)).toBe(false)
  })

  it('keeps the quiet zone light', () => {
    const qr = ok(encodeQr('hello', { border: 4 }))
    for (let i = 0; i < qr.size; i++) {
      for (let b = 0; b < 4; b++) {
        expect(qr.matrix[b]![i]).toBe(false)
        expect(qr.matrix[qr.size - 1 - b]![i]).toBe(false)
        expect(qr.matrix[i]![b]).toBe(false)
        expect(qr.matrix[i]![qr.size - 1 - b]).toBe(false)
      }
    }
  })

  it('defaults to border 4 and clamps nonsense borders', () => {
    expect(ok(encodeQr('x')).border).toBe(4)
    expect(ok(encodeQr('x', { border: -3 })).border).toBe(0)
    expect(ok(encodeQr('x', { border: Number.NaN })).border).toBe(4)
    expect(ok(encodeQr('x', { border: 2.6 })).border).toBe(3)
  })

  it('reports the ECC level asked for, without boosting it', () => {
    // "hi" fits version 1 at H, so a boosting encoder would raise L to H.
    expect(ok(encodeQr('hi', { ecc: 'L' })).ecc).toBe('L')
  })

  it('picks a larger version at a higher ECC level for the same data', () => {
    const text = 'x'.repeat(100)
    expect(ok(encodeQr(text, { ecc: 'H' })).version).toBeGreaterThan(ok(encodeQr(text, { ecc: 'L' })).version)
  })
})

describe('encodeQr: warnings', () => {
  it('warns on a thin quiet zone, not on the default', () => {
    expect(ok(encodeQr('x', { border: 1 })).warnings[0]).toMatch(/quiet zone of 1 module /)
    expect(ok(encodeQr('x', { border: 2 })).warnings).toEqual([])
  })

  it('warns on a dense version', () => {
    expect(ok(encodeQr('x'.repeat(1500), { ecc: 'L' })).warnings.some((w) => w.includes('dense'))).toBe(true)
    expect(ok(encodeQr('x'.repeat(50))).warnings).toEqual([])
  })
})

describe('encodeQr: modes and byte counts', () => {
  it('detects the mode uqr will use', () => {
    expect(detectMode('0123')).toBe('numeric')
    expect(detectMode('HELLO WORLD: $1.50')).toBe('alphanumeric')
    expect(detectMode('hello')).toBe('byte')
    // Non-ASCII digits are not numeric mode.
    expect(detectMode('١٢٣')).toBe('byte')
  })

  it('counts UTF-8 bytes in byte mode', () => {
    expect(ok(encodeQr('é☕🛜')).bytes).toBe(2 + 3 + 4)
  })

  it('refuses empty input and lone surrogates as data', () => {
    expect(encodeQr('')).toMatchObject({ ok: false, reason: 'empty' })
    expect(encodeQr('a\uD800b')).toMatchObject({ ok: false, reason: 'invalid' })
  })
})

describe('encodeQr: too long', () => {
  const sample: Record<QrMode, string> = { numeric: '7', alphanumeric: 'A', byte: 'a' }

  // Each limit fits at version 40, and one more character fails. This pins the
  // capacity table to what uqr actually does.
  for (const mode of ['numeric', 'alphanumeric', 'byte'] as const) {
    for (const ecc of ECC_LEVELS) {
      it(`${mode} at ${ecc}: ${CAPACITY[mode][ecc]} fits, one more does not`, () => {
        const limit = CAPACITY[mode][ecc]
        expect(ok(encodeQr(sample[mode].repeat(limit), { ecc })).version).toBe(40)
        expect(encodeQr(sample[mode].repeat(limit + 1), { ecc })).toMatchObject({
          ok: false,
          reason: 'too-long',
          bytes: limit + 1,
          limit,
          mode,
          ecc,
        })
      })
    }
  }

  it('counts multibyte characters against the byte limit', () => {
    // 1000 × 2-byte é = 2000 bytes: over Q's 1663 although only 1000 characters.
    const r = encodeQr('é'.repeat(1000), { ecc: 'Q' })
    expect(r).toMatchObject({ ok: false, reason: 'too-long', bytes: 2000, limit: 1663 })
    expect(!r.ok && r.message).toMatch(/2000 bytes, the limit is 1663/)
  })

  it('fails fast on a huge paste', () => {
    const start = performance.now()
    expect(encodeQr('x'.repeat(5_000_000)).ok).toBe(false)
    expect(performance.now() - start).toBeLessThan(500)
  })
})
