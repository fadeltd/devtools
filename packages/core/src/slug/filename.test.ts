import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  FALLBACK_FILENAME,
  MIN_FILENAME_BYTES,
  isReservedFilename,
  safeFilename,
} from './filename.ts'

const bytes = (s: string) => new TextEncoder().encode(s).length
const name = (s: string, opts = {}) => safeFilename(s, opts).name

const RESERVED = [
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 10 }, (_, i) => `COM${i}`),
  ...Array.from({ length: 10 }, (_, i) => `LPT${i}`),
  'COM¹', 'COM²', 'COM³', 'LPT¹', 'LPT²', 'LPT³',
]

describe('safeFilename: forbidden characters', () => {
  it('leaves a safe name untouched', () => {
    const r = safeFilename('report-2026 (final).pdf')
    expect(r.name).toBe('report-2026 (final).pdf')
    expect(r.changed).toBe(false)
    expect(r.changes).toEqual({
      removedChars: 0,
      trimmed: false,
      reserved: false,
      truncated: false,
      fallback: false,
    })
  })

  it('replaces every forbidden printable character', () => {
    const r = safeFilename('a/b\\c:d*e?f"g<h>i|j')
    expect(r.name).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(r.changes.removedChars).toBe(9)
    expect(r.changed).toBe(true)
  })

  it('replaces control characters and DEL', () => {
    expect(name('a\u0000b\u001fc\u007fd\te\nf')).toBe('a_b_c_d_e_f')
  })

  it('replaces C1 controls, which are invisible in a file browser', () => {
    expect(name('a\u0085b\u009fc')).toBe('a_b_c')
  })

  it('uses the chosen replacement, or none', () => {
    expect(name('a:b', { replacement: '-' })).toBe('a-b')
    expect(name('a:b', { replacement: '' })).toBe('ab')
  })

  it('removes unpaired surrogates, which have no UTF-8 form', () => {
    const r = safeFilename('a\uD800b\uDC00c')
    expect(r.name).toBe('a_b_c')
    expect(r.changes.removedChars).toBe(2)
  })

  it('keeps a valid surrogate pair', () => {
    expect(name('🎉 party.txt')).toBe('🎉 party.txt')
  })
})

describe('safeFilename: trimming', () => {
  it('strips trailing dots and spaces', () => {
    const r = safeFilename('notes.txt. . ')
    expect(r.name).toBe('notes.txt')
    expect(r.changes.trimmed).toBe(true)
  })

  it('trims leading whitespace but keeps a leading dot', () => {
    expect(name('   readme')).toBe('readme')
    expect(name('.gitignore')).toBe('.gitignore')
  })

  it('strips a trailing dot exposed by a replacement-free removal', () => {
    expect(name('end.?', { replacement: '' })).toBe('end')
  })
})

describe('safeFilename: fallback', () => {
  it('never returns empty', () => {
    const r = safeFilename('')
    expect(r.name).toBe(FALLBACK_FILENAME)
    expect(r.changes.fallback).toBe(true)
    expect(name('   ')).toBe(FALLBACK_FILENAME)
    expect(name('???', { replacement: '' })).toBe(FALLBACK_FILENAME)
  })

  it('never returns . or ..', () => {
    expect(name('.')).toBe(FALLBACK_FILENAME)
    expect(name('..')).toBe(FALLBACK_FILENAME)
    expect(name('. .')).toBe(FALLBACK_FILENAME)
  })
})

describe('safeFilename: reserved Windows names', () => {
  it.each(RESERVED)('prefixes %s, bare and with an extension, in any case', (dev) => {
    for (const variant of [dev, dev.toLowerCase(), `${dev}.txt`, `${dev.toLowerCase()}.tar.gz`]) {
      const r = safeFilename(variant)
      expect(r.name).toBe(`_${variant}`)
      expect(r.changes.reserved).toBe(true)
    }
  })

  it('catches a device name with spaces before the dot', () => {
    expect(name('CON .txt')).toBe('_CON .txt')
  })

  it('catches a device name exposed by trimming', () => {
    expect(name('  nul.  ')).toBe('_nul')
  })

  it('leaves names that only contain a device name', () => {
    for (const ok of ['CONSOLE', 'console.log', 'COM10', 'LPT', 'AUXILIARY.txt', 'my-con.txt']) {
      expect(safeFilename(ok).changes.reserved).toBe(false)
      expect(isReservedFilename(ok)).toBe(false)
    }
  })
})

describe('safeFilename: byte cap', () => {
  it('cuts an ASCII name to 255 bytes and keeps the extension', () => {
    const r = safeFilename(`${'a'.repeat(300)}.txt`)
    expect(bytes(r.name)).toBe(255)
    expect(r.name.endsWith('.txt')).toBe(true)
    expect(r.changes.truncated).toBe(true)
  })

  it('counts bytes, not characters, for multi-byte text', () => {
    // 'é' is 2 bytes, so 200 of them is 400 bytes although only 200 chars.
    const r = safeFilename(`${'é'.repeat(200)}.md`)
    expect(bytes(r.name)).toBeLessThanOrEqual(255)
    expect(r.name).toBe(`${'é'.repeat(126)}.md`)
  })

  it('never splits a surrogate pair', () => {
    const r = safeFilename(`${'😀'.repeat(100)}.png`)
    expect(bytes(r.name)).toBeLessThanOrEqual(255)
    expect(r.name).toBe(`${'😀'.repeat(62)}.png`)
  })

  it('cuts at a grapheme boundary', () => {
    // e + combining acute: 3 bytes per grapheme, so a code-point cut at 255
    // would orphan the accent from its base letter.
    const r = safeFilename(`x${'é'.repeat(100)}`)
    expect(r.name).toBe(`x${'é'.repeat(84)}`)
  })

  it('keeps ZWJ emoji whole', () => {
    const family = '👨‍👩‍👧' // 18 bytes
    const r = safeFilename(family.repeat(20))
    expect(r.name).toBe(family.repeat(14))
  })

  it('does not treat the tail of a sentence as an extension', () => {
    const long = `${'word '.repeat(60)}end. And then some more words`
    const r = safeFilename(long)
    expect(bytes(r.name)).toBeLessThanOrEqual(255)
    expect(r.name.endsWith('words')).toBe(false)
  })

  it('strips a trailing dot or space left by the cut', () => {
    const r = safeFilename(`${'a'.repeat(254)} b`)
    expect(r.name).toBe('a'.repeat(254))
  })

  it('honours a smaller cap, clamped to a sane minimum', () => {
    expect(bytes(name('a'.repeat(100), { maxBytes: 50 }))).toBe(50)
    expect(bytes(name('a'.repeat(100), { maxBytes: 1 }))).toBe(MIN_FILENAME_BYTES)
  })

  it('keeps a reserved prefix within the cap', () => {
    const r = safeFilename(`con.${'x'.repeat(300)}`)
    expect(r.name.startsWith('_con')).toBe(true)
    expect(bytes(r.name)).toBeLessThanOrEqual(255)
  })

  it('falls back when only dots and spaces survive the cut', () => {
    const r = safeFilename(`.${' .'.repeat(200)}x`)
    expect(r.name).toBe(FALLBACK_FILENAME)
    expect(r.changes.truncated).toBe(true)
  })
})

describe('safeFilename: properties', () => {
  const FORBIDDEN = /[/\\:*?"<>|\p{Cc}]/u

  it('is always safe on every platform', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 400 }),
        fc.constantFrom('_', '-', '' as const),
        (s, replacement) => {
          const out = safeFilename(s, { replacement }).name
          expect(out).not.toMatch(FORBIDDEN)
          expect(bytes(out)).toBeLessThanOrEqual(255)
          expect(out).not.toBe('')
          expect(out).not.toBe('.')
          expect(out).not.toBe('..')
          expect(out).not.toMatch(/[\s.]$/u)
          expect(isReservedFilename(out)).toBe(false)
          // Well-formed UTF-16: encoding round-trips without U+FFFD.
          expect(new TextDecoder().decode(new TextEncoder().encode(out))).toBe(out)
        },
      ),
    )
  })

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 400 }), (s) => {
        const once = safeFilename(s).name
        const twice = safeFilename(once)
        expect(twice.name).toBe(once)
        expect(twice.changed).toBe(false)
      }),
    )
  })

  it('stays within the cap for long multi-byte names with an extension', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', minLength: 100, maxLength: 300 }),
        fc.constantFrom('.txt', '.tar.gz', '.jpeg', ''),
        (stem, ext) => {
          const out = safeFilename(stem + ext).name
          expect(bytes(out)).toBeLessThanOrEqual(255)
        },
      ),
    )
  })
})
