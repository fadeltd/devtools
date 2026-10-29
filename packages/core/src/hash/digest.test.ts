import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ALGORITHMS, DIGEST_LENGTH, digest, digestAll, formatDigest, toHex, type Algorithm } from './digest.ts'

// FIPS 180-4 example messages (NIST CSRC "Examples with Intermediate Values").
const ABC = 'abc'
const EMPTY = ''
const M448 = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'

const VECTORS: Record<Algorithm, Record<string, string>> = {
  'SHA-1': {
    [ABC]: 'a9993e364706816aba3e25717850c26c9cd0d89d',
    [EMPTY]: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
    [M448]: '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
  },
  'SHA-256': {
    [ABC]: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    [EMPTY]: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    [M448]: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
  'SHA-384': {
    [ABC]:
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    [EMPTY]:
      '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
    [M448]:
      '3391fdddfc8dc7393707a65b1b4709397cf8b1d162af05abfe8f450de5f36bc6b0455a8520bc4e6f5fe95b1fe3c8452b',
  },
  'SHA-512': {
    [ABC]:
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    [EMPTY]:
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    [M448]:
      '204a8fc6dda82f0a0ced7beb8e08a41657c16ef468b228a8279be331a703c33596fd15c13b1b07f9aa1d3bea57789ca031ad85c7a71dd70354ec631238ca3445',
  },
}

describe('FIPS 180 vectors', () => {
  for (const algorithm of ALGORITHMS) {
    for (const [message, expected] of Object.entries(VECTORS[algorithm])) {
      const name = message === '' ? 'the empty string' : message.length > 3 ? 'the 448-bit message' : `"${message}"`
      it(`${algorithm} of ${name}`, async () => {
        expect(toHex(await digest(algorithm, message))).toBe(expected)
      })
    }
  }

  it('digestAll agrees with each single digest', async () => {
    const all = await digestAll(ABC)
    for (const algorithm of ALGORITHMS) expect(toHex(all[algorithm])).toBe(VECTORS[algorithm][ABC])
  })
})

describe('input bytes', () => {
  it('hashes strings as UTF-8', async () => {
    // printf 'café' | shasum -a 256
    const fromText = await digest('SHA-256', 'café')
    const fromBytes = await digest('SHA-256', new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9]))
    expect(toHex(fromText)).toBe(toHex(fromBytes))
  })

  it('never trims: a trailing newline is a different message', async () => {
    // The echo-vs-printf trap: `echo abc | shasum` hashes "abc\n".
    expect(toHex(await digest('SHA-256', 'abc\n'))).toBe(
      'edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb',
    )
    expect(toHex(await digest('SHA-256', 'abc\r\n'))).not.toBe(toHex(await digest('SHA-256', 'abc\n')))
  })

  it('returns the documented length for every algorithm', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 300 }), async (bytes) => {
        const all = await digestAll(bytes)
        for (const a of ALGORITHMS) expect(all[a].length).toBe(DIGEST_LENGTH[a])
      }),
      { numRuns: 30 },
    )
  })
})

describe('formatDigest', () => {
  const bytes = new Uint8Array([0x00, 0xfb, 0xff, 0xfe, 0x0a])

  it('formats hex in both cases, zero-padded', () => {
    expect(formatDigest(bytes, 'hex')).toBe('00fbfffe0a')
    expect(formatDigest(bytes, 'HEX')).toBe('00FBFFFE0A')
  })

  it('formats base64 padded and base64url unpadded', () => {
    expect(formatDigest(bytes, 'base64')).toBe('APv//go=')
    expect(formatDigest(bytes, 'base64url')).toBe('APv__go')
  })

  it('matches the well-known base64 SHA-256 of the empty string', async () => {
    expect(formatDigest(await digest('SHA-256', ''), 'base64')).toBe(
      '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
    )
  })
})
