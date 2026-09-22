import { describe, expect, it } from 'vitest'
import { firstInvalidIndex, sanitizeBase64Input } from './sanitize'
import { sniffMime } from './magic'

describe('sanitizeBase64Input', () => {
  it('strips a data: URI header and reports the MIME', () => {
    const s = sanitizeBase64Input('data:image/png;base64,iVBORw0K')
    expect(s.payload).toBe('iVBORw0K')
    expect(s.mime).toBe('image/png')
    expect(s.wasDataUri).toBe(true)
    expect(s.plainDataUri).toBe(false)
  })

  it('captures a charset parameter', () => {
    const s = sanitizeBase64Input('data:text/plain;charset=utf-8;base64,aGk=')
    expect(s.charset).toBe('utf-8')
    expect(s.mime).toBe('text/plain')
  })

  it('flags a data: URI that is not base64 at all', () => {
    const s = sanitizeBase64Input('data:text/plain,hello%20world')
    expect(s.plainDataUri).toBe(true)
  })

  it('strips PEM and MIME line wrapping', () => {
    const s = sanitizeBase64Input('aGVs\nbG8g\r\nd29y\n')
    expect(s.payload).toBe('aGVsbG8gd29y')
    // '\n' + '\r\n' + '\n' = 4 characters removed.
    expect(s.strippedWhitespace).toBe(4)
  })

  it('percent-decodes base64 that came through a URL', () => {
    const s = sanitizeBase64Input('aGk%3D')
    expect(s.payload).toBe('aGk=')
    expect(s.wasPercentEncoded).toBe(true)
  })

  it('detects the url-safe alphabet', () => {
    expect(sanitizeBase64Input('a-b_c').wasUrlSafe).toBe(true)
    expect(sanitizeBase64Input('a+b/c').wasUrlSafe).toBe(false)
  })

  it('strips a BOM and says so', () => {
    const s = sanitizeBase64Input('﻿aGk=')
    expect(s.hadBom).toBe(true)
    expect(s.payload).toBe('aGk=')
  })

  it('leaves clean input untouched and reports no changes', () => {
    const s = sanitizeBase64Input('aGVsbG8=')
    expect(s.payload).toBe('aGVsbG8=')
    expect(s.wasDataUri).toBe(false)
    expect(s.strippedWhitespace).toBe(0)
    expect(s.wasPercentEncoded).toBe(false)
  })
})

describe('firstInvalidIndex', () => {
  it('returns null for valid input', () => {
    expect(firstInvalidIndex('aGVsbG8=', 'base64')).toBeNull()
  })

  it('locates the offending character with line and column', () => {
    const hit = firstInvalidIndex('aGVs\nbG8*', 'base64')
    expect(hit).toEqual({ index: 8, char: '*', line: 2, column: 4 })
  })

  it('treats - and _ as invalid under the standard alphabet', () => {
    expect(firstInvalidIndex('aG-k', 'base64')?.char).toBe('-')
    expect(firstInvalidIndex('aG-k', 'base64url')).toBeNull()
  })

  it('treats + and / as invalid under base64url', () => {
    expect(firstInvalidIndex('aG+k', 'base64url')?.char).toBe('+')
  })
})

describe('sniffMime', () => {
  const cases: Array<[string, number[], string]> = [
    ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
    ['jpeg', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
    ['gif', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'image/gif'],
    ['pdf', [0x25, 0x50, 0x44, 0x46, 0x2d], 'application/pdf'],
    ['gzip', [0x1f, 0x8b, 0x08], 'application/gzip'],
    ['zip', [0x50, 0x4b, 0x03, 0x04], 'application/zip'],
    ['wasm', [0x00, 0x61, 0x73, 0x6d, 0x01], 'application/wasm'],
    ['bmp', [0x42, 0x4d, 0x00], 'image/bmp'],
    ['ico', [0x00, 0x00, 0x01, 0x00], 'image/x-icon'],
  ]

  for (const [name, bytes, mime] of cases) {
    it(`identifies ${name}`, () => {
      const s = sniffMime(new Uint8Array(bytes))
      expect(s.mime).toBe(mime)
      expect(s.confidence).toBe('magic')
    })
  }

  it('identifies webp via the RIFF container', () => {
    const b = new Uint8Array(16)
    b.set([0x52, 0x49, 0x46, 0x46], 0)
    b.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(sniffMime(b).mime).toBe('image/webp')
  })

  it('identifies avif by its ISO-BMFF brand', () => {
    const b = new Uint8Array(16)
    b.set([0x66, 0x74, 0x79, 0x70], 4) // 'ftyp'
    b.set([0x61, 0x76, 0x69, 0x66], 8) // 'avif'
    expect(sniffMime(b).mime).toBe('image/avif')
  })

  it('identifies SVG as a text sniff, past an XML declaration', () => {
    const svg = '<?xml version="1.0"?>\n<!-- a comment -->\n<svg xmlns="..."></svg>'
    const s = sniffMime(new TextEncoder().encode(svg))
    expect(s.mime).toBe('image/svg+xml')
    // Reported as a heuristic, so a wrong guess is visible rather than silent.
    expect(s.confidence).toBe('text')
  })

  it('does not mistake arbitrary XML for SVG', () => {
    const s = sniffMime(new TextEncoder().encode('<?xml version="1.0"?><root/>'))
    expect(s.mime).not.toBe('image/svg+xml')
  })

  it('falls back to octet-stream with no confidence', () => {
    const s = sniffMime(new Uint8Array([1, 2, 3, 4]))
    expect(s.mime).toBe('application/octet-stream')
    expect(s.confidence).toBe('none')
  })

  it('handles empty input', () => {
    expect(sniffMime(new Uint8Array()).confidence).toBe('none')
  })
})
