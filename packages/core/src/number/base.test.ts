import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  bitLength,
  convertBase,
  formatInBase,
  groupDigits,
  MAX_DIGITS,
  parseInteger,
  signedBitLength,
  twosComplement,
} from './base.ts'

const value = (input: string, base = 10): bigint => {
  const r = parseInteger(input, base)
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

describe('parseInteger', () => {
  it('reads each base, case-insensitively', () => {
    expect(value('ff', 16)).toBe(255n)
    expect(value('FF', 16)).toBe(255n)
    expect(value('777', 8)).toBe(511n)
    expect(value('1010', 2)).toBe(10n)
    expect(value('zz', 36)).toBe(1295n)
    expect(value('Zz', 36)).toBe(1295n)
    expect(value('21', 3)).toBe(7n)
  })

  it('keeps precision far past 2^53', () => {
    expect(value('9007199254740993')).toBe(9007199254740993n)
    expect(value('ffffffffffffffff', 16)).toBe(18446744073709551615n)
    expect(value('1' + '0'.repeat(80), 7)).toBe(7n ** 80n)
  })

  it('lets a prefix override the selected base, and says so', () => {
    expect(parseInteger('0xff', 10)).toMatchObject({ ok: true, value: 255n, base: 16, prefix: '0x' })
    expect(parseInteger('0B101', 10)).toMatchObject({ ok: true, value: 5n, base: 2, prefix: '0b' })
    expect(parseInteger('0o17', 2)).toMatchObject({ ok: true, value: 15n, base: 8, prefix: '0o' })
    // In hex, "0b10" is still read as binary: the prefix wins, visibly.
    expect(parseInteger('0b10', 16)).toMatchObject({ ok: true, value: 2n, prefix: '0b' })
    expect(parseInteger('ff', 16)).toMatchObject({ ok: true, prefix: null, base: 16 })
  })

  it('accepts _ , and spaces as digit separators', () => {
    expect(value('1_000_000')).toBe(1000000n)
    expect(value('1,000,000')).toBe(1000000n)
    expect(value('dead beef', 16)).toBe(0xdeadbeefn)
    expect(value('0x_ff_ff')).toBe(0xffffn)
    expect(value('  42\n')).toBe(42n)
    expect(value('1111 0000\t1111', 2)).toBe(0b111100001111n)
  })

  it('handles signs', () => {
    expect(value('-42')).toBe(-42n)
    expect(value('+42')).toBe(42n)
    expect(value('-0x80')).toBe(-128n)
    expect(value('-0')).toBe(0n)
  })

  it('reports an invalid digit with its index and character', () => {
    expect(parseInteger('1012', 2)).toEqual({
      ok: false,
      error: { code: 'invalid-digit', message: '“2” is not a valid digit in binary.', index: 3, char: '2' },
    })
    expect(parseInteger('  0xfg', 10)).toMatchObject({ ok: false, error: { index: 5, char: 'g' } })
    expect(parseInteger('12a', 10)).toMatchObject({ ok: false, error: { index: 2, char: 'a' } })
    expect(parseInteger('1.5', 10)).toMatchObject({
      ok: false,
      error: { index: 1, message: 'Only whole numbers can be converted between bases.' },
    })
    expect(parseInteger('1-2', 10)).toMatchObject({ ok: false, error: { index: 1, char: '-' } })
    expect(parseInteger('12é', 10)).toMatchObject({ ok: false, error: { index: 2, message: '“é” is not a digit.' } })
  })

  it('reports empty input', () => {
    expect(parseInteger('', 10)).toMatchObject({ ok: false, error: { code: 'empty' } })
    expect(parseInteger('   ', 10)).toMatchObject({ ok: false, error: { code: 'empty' } })
    expect(parseInteger('-', 10)).toMatchObject({ ok: false, error: { code: 'empty' } })
    expect(parseInteger('_,_', 10)).toMatchObject({ ok: false, error: { code: 'empty' } })
    expect(parseInteger('0x', 10)).toMatchObject({ ok: false, error: { code: 'empty', message: 'No digits after 0x.' } })
  })

  it('caps the digit count, not counting separators', () => {
    expect(parseInteger('1'.repeat(MAX_DIGITS), 2).ok).toBe(true)
    expect(parseInteger('1_'.repeat(MAX_DIGITS), 2).ok).toBe(true)
    expect(parseInteger('1'.repeat(MAX_DIGITS + 1), 2)).toMatchObject({ ok: false, error: { code: 'too-long' } })
  })

  it('rejects a base outside 2–36', () => {
    for (const b of [0, 1, 37, 2.5, Number.NaN]) {
      expect(parseInteger('1', b)).toMatchObject({ ok: false, error: { code: 'invalid-base' } })
    }
  })
})

describe('round trip', () => {
  const big = fc.bigInt({ min: -(1n << 300n), max: 1n << 300n })

  it('every base output parses back to the same value', () => {
    fc.assert(
      fc.property(big, fc.integer({ min: 2, max: 36 }), (n, base) => {
        expect(value(formatInBase(n, base), base)).toBe(n)
        expect(value(formatInBase(n, base).toUpperCase(), base)).toBe(n)
      }),
    )
  })

  it('convertBase outputs all parse back, including the custom base', () => {
    fc.assert(
      fc.property(big, fc.integer({ min: 2, max: 36 }), fc.integer({ min: 2, max: 36 }), (n, from, custom) => {
        const r = convertBase(formatInBase(n, from), from, custom)
        if (!r.ok) throw new Error(r.error.message)
        expect(r.value).toBe(n)
        const { bin, oct, dec, hex, base36 } = r.outputs
        expect(value(bin, 2)).toBe(n)
        expect(value(oct, 8)).toBe(n)
        expect(value(dec, 10)).toBe(n)
        expect(value(hex, 16)).toBe(n)
        expect(value(base36, 36)).toBe(n)
        expect(value(r.outputs.custom, custom)).toBe(n)
      }),
    )
  })

  it('grouped output still parses back', () => {
    fc.assert(
      fc.property(big, fc.integer({ min: 1, max: 8 }), (n, size) => {
        expect(value(groupDigits(formatInBase(n, 2), size), 2)).toBe(n)
      }),
    )
  })
})

describe('groupDigits', () => {
  it('groups from the right and keeps the sign', () => {
    expect(groupDigits('11111111', 4)).toBe('1111 1111')
    expect(groupDigits('111111111', 4)).toBe('1 1111 1111')
    expect(groupDigits('-1234567', 3, ',')).toBe('-1,234,567')
    expect(groupDigits('123', 3)).toBe('123')
  })
})

describe('bit length', () => {
  it('counts the magnitude', () => {
    expect(bitLength(0n)).toBe(0)
    expect(bitLength(1n)).toBe(1)
    expect(bitLength(255n)).toBe(8)
    expect(bitLength(256n)).toBe(9)
    expect(bitLength(-255n)).toBe(8)
  })

  it('counts the narrowest signed width', () => {
    expect(signedBitLength(-1n)).toBe(1)
    expect(signedBitLength(-128n)).toBe(8)
    expect(signedBitLength(-129n)).toBe(9)
    expect(signedBitLength(127n)).toBe(8)
    expect(signedBitLength(128n)).toBe(9)
  })
})

describe('twosComplement', () => {
  it('-128 fits in 8 bits, -129 does not', () => {
    expect(twosComplement(-128n, 8)).toEqual({ bits: 8, fits: true, bin: '10000000', hex: '80' })
    expect(twosComplement(-129n, 8)).toEqual({ bits: 8, fits: false })
    expect(twosComplement(-129n, 16)).toEqual({ bits: 16, fits: true, bin: '1111111101111111', hex: 'ff7f' })
  })

  it('handles the other boundaries', () => {
    expect(twosComplement(-1n, 8)).toMatchObject({ fits: true, hex: 'ff' })
    expect(twosComplement(-32768n, 16)).toMatchObject({ fits: true, hex: '8000' })
    expect(twosComplement(-32769n, 16)).toMatchObject({ fits: false })
    expect(twosComplement(-(2n ** 31n), 32)).toMatchObject({ fits: true, hex: '80000000' })
    expect(twosComplement(-(2n ** 63n), 64)).toMatchObject({ fits: true, hex: '8000000000000000' })
    expect(twosComplement(-(2n ** 63n) - 1n, 64)).toMatchObject({ fits: false })
  })

  it('is the width-masked value, for every width', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(1n << 63n), max: -1n }), fc.constantFrom(8, 16, 32, 64 as const), (n, bits) => {
        const r = twosComplement(n, bits as 8 | 16 | 32 | 64)
        const fits = n >= -(1n << BigInt(bits - 1))
        expect(r.fits).toBe(fits)
        if (r.fits) {
          expect(BigInt.asIntN(bits, BigInt(`0b${r.bin}`))).toBe(n)
          expect(BigInt(`0x${r.hex}`)).toBe(BigInt.asUintN(bits, n))
        }
      }),
    )
  })
})

describe('convertBase', () => {
  it('lists two’s complement only for negatives', () => {
    const neg = convertBase('-129', 10, 3)
    expect(neg.ok && neg.twos.map((t) => t.fits)).toEqual([false, true, true, true])
    const pos = convertBase('129', 10, 3)
    expect(pos.ok && pos.twos).toEqual([])
  })

  it('fills every output', () => {
    expect(convertBase('255', 10, 7)).toMatchObject({
      ok: true,
      bitLength: 8,
      outputs: { bin: '11111111', oct: '377', dec: '255', hex: 'ff', base36: '73', custom: '513' },
    })
  })

  it('rejects a bad custom base', () => {
    expect(convertBase('1', 10, 40)).toMatchObject({ ok: false, error: { code: 'invalid-base' } })
  })
})
