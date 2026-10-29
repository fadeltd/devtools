import { describe, expect, it } from 'vitest'
import { parseBase64, parseHex } from './bytes.ts'
import { toHex, type Algorithm } from './digest.ts'
import { decodeKey, hmac } from './hmac.ts'

const repeat = (byte: number, n: number) => new Uint8Array(n).fill(byte)
const ascii = (s: string) => new TextEncoder().encode(s)
const range = (from: number, to: number) =>
  Uint8Array.from({ length: to - from + 1 }, (_, i) => from + i)

async function mac(algorithm: Algorithm, key: Uint8Array, data: Uint8Array): Promise<string> {
  const r = await hmac(algorithm, key, data)
  if (!r.ok) throw new Error(r.message)
  return toHex(r.bytes)
}

// RFC 4231 §4. Test case 5 is omitted: its output is truncated to 128 bits.
const LARGE_KEY = repeat(0xaa, 131)
const RFC4231: { name: string; key: Uint8Array; data: Uint8Array; out: Record<string, string> }[] = [
  {
    name: 'test case 1',
    key: repeat(0x0b, 20),
    data: ascii('Hi There'),
    out: {
      'SHA-256': 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
      'SHA-384':
        'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6',
      'SHA-512':
        '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
    },
  },
  {
    name: 'test case 2 (key shorter than the output)',
    key: ascii('Jefe'),
    data: ascii('what do ya want for nothing?'),
    out: {
      'SHA-256': '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      'SHA-384':
        'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649',
      'SHA-512':
        '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
    },
  },
  {
    name: 'test case 3',
    key: repeat(0xaa, 20),
    data: repeat(0xdd, 50),
    out: {
      'SHA-256': '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
      'SHA-384':
        '88062608d3e6ad8a0aa2ace014c8a86f0aa635d947ac9febe83ef4e55966144b2a5ab39dc13814b94e3ab6e101a34f27',
      'SHA-512':
        'fa73b0089d56a284efb0f0756c890be9b1b5dbdd8ee81a3655f83e33b2279d39bf3e848279a722c806b485a47e67c807b946a337bee8942674278859e13292fb',
    },
  },
  {
    name: 'test case 4',
    key: range(0x01, 0x19),
    data: repeat(0xcd, 50),
    out: {
      'SHA-256': '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
      'SHA-384':
        '3e8a69b7783c25851933ab6290af6ca77a9981480850009cc5577c6e1f573b4e6801dd23c4a7d679ccf8a386c674cffb',
      'SHA-512':
        'b0ba465637458c6990e5a8c5f61d4af7e576d97ff94b872de76f8050361ee3dba91ca5c11aa25eb4d679275cc5788063a5f19741120c4f2de2adebeb10a298dd',
    },
  },
  {
    name: 'test case 6 (key larger than the block size)',
    key: LARGE_KEY,
    data: ascii('Test Using Larger Than Block-Size Key - Hash Key First'),
    out: {
      'SHA-256': '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
      'SHA-384':
        '4ece084485813e9088d2c63a041bc5b44f9ef1012a2b588f3cd11f05033ac4c60c2ef6ab4030fe8296248df163f44952',
      'SHA-512':
        '80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598',
    },
  },
  {
    name: 'test case 7 (key and data larger than the block size)',
    key: LARGE_KEY,
    data: ascii(
      'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
    ),
    out: {
      'SHA-256': '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
      'SHA-384':
        '6617178e941f020d351e2f254e8fd32c602420feb0b8fb9adccebb82461e99c5a678cc31e799176d3860e6110c46523e',
      'SHA-512':
        'e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58',
    },
  },
]

describe('RFC 4231: HMAC-SHA-256, -384 and -512', () => {
  for (const tc of RFC4231) {
    for (const [algorithm, expected] of Object.entries(tc.out)) {
      it(`${tc.name}, ${algorithm}`, async () => {
        expect(await mac(algorithm as Algorithm, tc.key, tc.data)).toBe(expected)
      })
    }
  }
})

describe('RFC 2202: HMAC-SHA-1', () => {
  const cases: [string, Uint8Array, Uint8Array, string][] = [
    ['test case 1', repeat(0x0b, 20), ascii('Hi There'), 'b617318655057264e28bc0b6fb378c8ef146be00'],
    ['test case 2', ascii('Jefe'), ascii('what do ya want for nothing?'), 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79'],
    ['test case 3', repeat(0xaa, 20), repeat(0xdd, 50), '125d7342b9ac11cd91a39af48aa17b4f63f175d3'],
    ['test case 4', range(0x01, 0x19), repeat(0xcd, 50), '4c9007f4026250c6bc8414f9bf50c86c2d7235da'],
    ['test case 5', repeat(0x0c, 20), ascii('Test With Truncation'), '4c1a03424b55e07fe7f27be1d58bb9324a9a5a04'],
    [
      'test case 6',
      repeat(0xaa, 80),
      ascii('Test Using Larger Than Block-Size Key - Hash Key First'),
      'aa4ae5e15272d00e95705637ce8a3b55ed402112',
    ],
    [
      'test case 7',
      repeat(0xaa, 80),
      ascii('Test Using Larger Than Block-Size Key and Larger Than One Block-Size Data'),
      'e8e99d0f45237d786d6bbaa7965c7808bbff1a91',
    ],
  ]
  for (const [name, key, data, expected] of cases) {
    it(name, async () => {
      expect(await mac('SHA-1', key, data)).toBe(expected)
    })
  }
})

describe('key encodings', () => {
  it('reads the same key as text, hex and base64', async () => {
    const data = 'what do ya want for nothing?'
    const expected = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
    const keys = [
      ['Jefe', 'text'],
      ['4a656665', 'hex'],
      ['4A 65 66 65', 'hex'],
      ['0x4a656665', 'hex'],
      ['SmVmZQ==', 'base64'],
      ['SmVmZQ', 'base64'],
    ] as const
    const results = await Promise.all(keys.map(([key, enc]) => hmac('SHA-256', key, data, enc)))
    expect(results.map((r) => r.ok && toHex(r.bytes))).toEqual(keys.map(() => expected))
  })

  it('reads the RFC 4231 test case 1 key from hex text', async () => {
    const r = await hmac('SHA-256', '0b'.repeat(20), 'Hi There', 'hex')
    expect(r.ok && toHex(r.bytes)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    )
  })

  it('treats a text key as UTF-8, prefix and all', () => {
    const r = decodeKey('whsec_é', 'text')
    expect(r.ok && [...r.bytes].slice(-2)).toEqual([0xc3, 0xa9])
  })

  it('accepts an empty key, which WebCrypto alone rejects', async () => {
    // Python: hmac.new(b'', b'', 'sha256').hexdigest()
    const r = await hmac('SHA-256', '', '')
    expect(r.ok && toHex(r.bytes)).toBe(
      'b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad',
    )
  })
})

describe('key encoding errors are reported, not thrown', () => {
  it('flags a non-hex character with its position', async () => {
    const r = await hmac('SHA-256', '4a6g', 'x', 'hex')
    expect(r).toMatchObject({ ok: false, position: 3 })
    if (!r.ok) expect(r.message).toContain('“g”')
  })

  it('positions refer to the original text, whitespace included', () => {
    expect(parseHex('ab cd zz')).toMatchObject({ ok: false, position: 6 })
  })

  it('flags an odd number of hex digits', async () => {
    const r = await hmac('SHA-256', 'abc', 'x', 'hex')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/odd/i)
  })

  it('flags a non-base64 character with its position', async () => {
    const r = await hmac('SHA-256', 'SmV*ZQ==', 'x', 'base64')
    expect(r).toMatchObject({ ok: false, position: 3 })
  })

  it('flags padding in the middle', () => {
    expect(parseBase64('Sm=VmZQ')).toMatchObject({ ok: false, position: 2 })
  })

  it('flags an impossible base64 length', async () => {
    const r = await hmac('SHA-256', 'SmVmZ', 'x', 'base64')
    expect(r.ok).toBe(false)
  })

  it('accepts base64url and ignores line breaks', () => {
    const r = parseBase64('-_-_\n')
    expect(r.ok && [...r.bytes]).toEqual([0xfb, 0xff, 0xbf])
  })
})
