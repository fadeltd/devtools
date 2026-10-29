import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bytesToBase64 } from '../base64/codec.ts'
import { MAX_SHARE_DECODED_BYTES, decodeShare, encodeShare } from './share.ts'

/** Hand-build a `1.` link around arbitrary bytes, compressed or not. */
async function linkOf(bytes: Uint8Array, compress = true): Promise<string> {
  let packed = bytes
  if (compress) {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    packed = new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return '1.' + bytesToBase64(packed, { alphabet: 'base64url', padding: false })
}

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

describe('share links', () => {
  it('round-trips any pair of documents', async () => {
    const text = fc.string({ unit: fc.constantFrom('a', 'Z', ' ', '\n', '\r\n', '\t', 'é', '😀', '"', '\\'), maxLength: 200 })
    await fc.assert(
      fc.asyncProperty(text, text, async (left, right) => {
        const value = await encodeShare(left, right)
        expect(value).toMatch(/^1\.[A-Za-z0-9_-]*$/)
        expect(await decodeShare(`#d=${value}`)).toEqual({ left, right })
      }),
    )
  })

  it('accepts the bare value as well as the full hash', async () => {
    const value = await encodeShare('a\n', 'b\n')
    expect(await decodeShare(value)).toEqual({ left: 'a\n', right: 'b\n' })
  })

  it('compresses repetitive text well below its size', async () => {
    const doc = 'networking:\n  host: 0.0.0.0\n  port: 3000\n'.repeat(100)
    expect((await encodeShare(doc, doc)).length).toBeLessThan(doc.length / 10)
  })

  it('rejects anything that is not an intact link', async () => {
    const good = await encodeShare('left', 'right')
    const bad = [
      '',
      '#d=',
      '#x=' + good,
      '2.' + good.slice(2),
      good.slice(0, good.length - 6),
      '1.!!!not-base64!!!',
      await linkOf(json(['a', 'b']), false),
      await linkOf(json(['only one'])),
      await linkOf(json(['a', 2])),
      await linkOf(json({ left: 'a', right: 'b' })),
      await linkOf(new Uint8Array([0x5b, 0x22, 0xff, 0xfe, 0x22, 0x5d])),
    ]
    expect(await Promise.all(bad.map(decodeShare))).toEqual(bad.map(() => null))
  })

  it('stops inflating a link past the decoded size limit', async () => {
    const bomb = json(['x'.repeat(MAX_SHARE_DECODED_BYTES), ''])
    const link = await linkOf(bomb)
    expect(link.length).toBeLessThan(10_000)
    expect(await decodeShare(link)).toBeNull()
  })
})
