import { describe, expect, it } from 'vitest'
import { sniffMime, type Sniffed } from './magic.ts'
import { effectiveMime, formatOutput, mimeMismatch, toCssUrl, toDataUri, toImgTag } from './snippets.ts'
import { svgDimensions } from './svg.ts'
import { FILE_MAX_BYTES, fileTier, headOf, INLINE_MAX_BYTES } from './tiers.ts'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const UNKNOWN: Sniffed = { mime: 'application/octet-stream', ext: 'bin', confidence: 'none' }

describe('fileTier', () => {
  it('splits exactly at the boundaries', () => {
    expect(fileTier(0)).toBe('inline')
    expect(fileTier(INLINE_MAX_BYTES)).toBe('inline')
    expect(fileTier(INLINE_MAX_BYTES + 1)).toBe('large')
    expect(fileTier(FILE_MAX_BYTES)).toBe('large')
    expect(fileTier(FILE_MAX_BYTES + 1)).toBe('refuse')
  })
})

describe('headOf', () => {
  it('returns short text whole', () => {
    expect(headOf('abc', 10)).toEqual({ head: 'abc', omitted: 0 })
  })

  it('cuts long text and counts what it left out', () => {
    expect(headOf('abcdefghij', 4)).toEqual({ head: 'abcd', omitted: 6 })
  })
})

describe('output forms', () => {
  it('builds a data: URI', () => {
    expect(toDataUri('image/png', 'AAAA')).toBe('data:image/png;base64,AAAA')
  })

  it('builds an <img> with size when known, and escapes the alt text', () => {
    expect(toImgTag('image/png', 'AAAA', { alt: 'a "quoted" <name> & co', size: { width: 2, height: 3 } })).toBe(
      '<img src="data:image/png;base64,AAAA" width="2" height="3" alt="a &quot;quoted&quot; &lt;name&gt; &amp; co">',
    )
    expect(toImgTag('image/png', 'AAAA', { alt: '', size: null })).toBe('<img src="data:image/png;base64,AAAA" alt="">')
  })

  it('builds a quoted CSS url()', () => {
    expect(toCssUrl('image/svg+xml', 'PHN2Zz4=')).toBe('url("data:image/svg+xml;base64,PHN2Zz4=")')
  })

  it('leaves plain base64 untouched', () => {
    expect(formatOutput('base64', 'image/png', 'AAAA', { alt: 'x' })).toBe('AAAA')
  })
})

describe('effectiveMime', () => {
  it('trusts the bytes over the filename or OS', () => {
    expect(effectiveMime('image/png', sniffMime(JPEG))).toBe('image/jpeg')
  })

  it('falls back to the declared type, normalised, when the bytes say nothing', () => {
    expect(effectiveMime('IMAGE/JPG', UNKNOWN)).toBe('image/jpeg')
    expect(effectiveMime('', UNKNOWN)).toBe('application/octet-stream')
  })
})

describe('mimeMismatch', () => {
  it('flags a JPEG saved as .png', () => {
    expect(mimeMismatch('photo.png', 'image/png', sniffMime(JPEG))).toBe('Named .png, but the bytes are image/jpeg.')
  })

  it('flags a declared type that disagrees when the extension is unknown', () => {
    expect(mimeMismatch('blob', 'image/gif', sniffMime(PNG))).toBe('Labelled image/gif, but the bytes are image/png.')
  })

  it('accepts aliases and both JPEG extensions', () => {
    expect(mimeMismatch('a.jpeg', 'image/jpg', sniffMime(JPEG))).toBeNull()
    expect(mimeMismatch('a.JPG', 'image/pjpeg', sniffMime(JPEG))).toBeNull()
  })

  it('never accuses on a heuristic or empty sniff', () => {
    const svg = sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    expect(svg.confidence).toBe('text')
    expect(mimeMismatch('icon.png', 'image/png', svg)).toBeNull()
    expect(mimeMismatch('x.png', 'image/png', UNKNOWN)).toBeNull()
  })
})

describe('svgDimensions', () => {
  it('reads pixel width and height', () => {
    expect(svgDimensions('<svg width="100" height="50px">')).toEqual({ width: 100, height: 50 })
  })

  it('is not fooled by stroke-width', () => {
    expect(svgDimensions('<svg stroke-width="3" viewBox="0 0 24 24">')).toEqual({ width: 24, height: 24 })
  })

  it('falls back to the viewBox for relative units', () => {
    expect(svgDimensions('<svg width="10em" height="100%" viewBox="0 0 300 150">')).toEqual({ width: 300, height: 150 })
  })

  it('derives the missing side from the viewBox aspect ratio', () => {
    expect(svgDimensions("<svg width='200' viewBox='0,0,300,150'>")).toEqual({ width: 200, height: 100 })
  })

  it('reads the root element after a prolog, and handles nothing usable', () => {
    expect(svgDimensions('<?xml version="1.0"?>\n<!-- c --><svg\n  width="16"\n  height="16">')).toEqual({ width: 16, height: 16 })
    expect(svgDimensions('<svg>')).toBeNull()
    expect(svgDimensions('<svg viewBox="0 0 0 10">')).toBeNull()
    expect(svgDimensions('not svg')).toBeNull()
  })
})
