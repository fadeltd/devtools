import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { slugify } from './slugify.ts'

describe('slugify: basics', () => {
  it('lowercases and joins words', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('collapses separator runs and trims both ends', () => {
    expect(slugify('  --Hello,   World!!  --')).toBe('hello-world')
    expect(slugify('a _ - . b')).toBe('a-b')
  })

  it('uses the chosen separator', () => {
    expect(slugify('Hello World', { separator: '_' })).toBe('hello_world')
    expect(slugify('Hello World', { separator: '.' })).toBe('hello.world')
  })

  it('keeps case when lowercase is off', () => {
    expect(slugify('Hello World', { lowercase: false })).toBe('Hello-World')
  })

  it('returns empty for text with nothing sluggable', () => {
    expect(slugify('')).toBe('')
    expect(slugify('!!! ??? ---')).toBe('')
    expect(slugify('🎉🚀')).toBe('')
  })

  it('keeps digits', () => {
    expect(slugify('Top 10 tips for 2026')).toBe('top-10-tips-for-2026')
    expect(slugify('3D printing')).toBe('3d-printing')
  })
})

describe('slugify: ascii folding', () => {
  it('strips diacritics', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee')
    expect(slugify('Ångström São Paulo naïve façade')).toBe('angstrom-sao-paulo-naive-facade')
  })

  it('transliterates German letters', () => {
    expect(slugify('Straße Größe Übermäßig')).toBe('strasse-grosse-ubermassig')
    expect(slugify('GROẞE', { lowercase: false })).toBe('GROSSE')
  })

  it('transliterates Nordic letters', () => {
    expect(slugify('Ærø Øresund Þórshöfn Æble')).toBe('aero-oresund-thorshofn-aeble')
    expect(slugify('blåbærsyltetøy')).toBe('blabaersyltetoy')
  })

  it('transliterates Polish and Croatian letters', () => {
    expect(slugify('Łódź Wrocław Gdańsk')).toBe('lodz-wroclaw-gdansk')
    expect(slugify('Đakovo đak')).toBe('dakovo-dak')
  })

  it('transliterates other letters NFKD keeps whole', () => {
    expect(slugify('œuvre Œdipe')).toBe('oeuvre-oedipe')
    expect(slugify('Iğdır ılık')).toBe('igdir-ilik')
    expect(slugify('Ðorðe')).toBe('dorde')
  })

  it('folds compatibility forms', () => {
    expect(slugify('ﬁle ２０２６ Ⅳ')).toBe('file-2026-iv')
  })

  it('drops emoji, treating them as word breaks', () => {
    expect(slugify('I ❤️ NY')).toBe('i-ny')
    expect(slugify('rocket🚀launch')).toBe('rocket-launch')
    expect(slugify('👨‍👩‍👧 family')).toBe('family')
  })

  it('drops scripts it cannot transliterate', () => {
    expect(slugify('東京 Tokyo')).toBe('tokyo')
  })
})

describe('slugify: unicode mode', () => {
  const unicode = { ascii: false } as const

  it('keeps CJK', () => {
    expect(slugify('東京 タワー', unicode)).toBe('東京-タワー')
    expect(slugify('你好，世界', unicode)).toBe('你好-世界')
  })

  it('keeps accents, in composed form', () => {
    expect(slugify('Crème Brûlée', unicode)).toBe('crème-brûlée')
    expect(slugify('Crème', unicode)).toBe('crème')
  })

  it('keeps combining marks a script needs', () => {
    expect(slugify('नमस्ते दुनिया', unicode)).toBe('नमस्ते-दुनिया')
  })

  it('drops emoji, including the variation selector after them', () => {
    expect(slugify('I ❤️ NY', unicode)).toBe('i-ny')
  })
})

describe('slugify: words', () => {
  it('spells & as and by default', () => {
    expect(slugify('Fish & Chips')).toBe('fish-and-chips')
    expect(slugify('R&D')).toBe('r-and-d')
  })

  it('drops & when asked', () => {
    expect(slugify('Fish & Chips', { ampersand: false })).toBe('fish-chips')
  })

  it('splits camelCase and PascalCase', () => {
    expect(slugify('fooBar')).toBe('foo-bar')
    expect(slugify('FooBarBaz')).toBe('foo-bar-baz')
    expect(slugify('getElementById')).toBe('get-element-by-id')
  })

  it('keeps acronyms whole, including plural ones', () => {
    expect(slugify('XMLHttpRequest')).toBe('xml-http-request')
    expect(slugify('HTTPServer')).toBe('http-server')
    expect(slugify('APIs and IDs')).toBe('apis-and-ids')
    expect(slugify('NASA')).toBe('nasa')
  })

  it('splits camelCase before folding, so a folded letter is not an acronym', () => {
    expect(slugify('Æble')).toBe('aeble')
    expect(slugify('ÉtéÉcole', { lowercase: false })).toBe('Ete-Ecole')
  })

  it('does not split words at apostrophes', () => {
    expect(slugify("Don't Stop")).toBe('dont-stop')
    expect(slugify('don’t stop')).toBe('dont-stop')
    expect(slugify("rock 'n' roll")).toBe('rock-n-roll')
  })
})

describe('slugify: maxLength', () => {
  it('leaves a short slug alone', () => {
    expect(slugify('hello world', { maxLength: 11 })).toBe('hello-world')
    expect(slugify('hello world', { maxLength: 0 })).toBe('hello-world')
  })

  it('truncates at a separator boundary', () => {
    expect(slugify('hello world again', { maxLength: 11 })).toBe('hello-world')
    expect(slugify('hello world again', { maxLength: 15 })).toBe('hello-world')
    expect(slugify('hello world again', { maxLength: 10 })).toBe('hello')
  })

  it('cuts a single word that is longer than the limit', () => {
    expect(slugify('supercalifragilistic word', { maxLength: 5 })).toBe('super')
  })

  it('counts code points, never splitting a surrogate pair', () => {
    expect(slugify('𠮷𠮷𠮷', { ascii: false, maxLength: 2 })).toBe('𠮷𠮷')
  })

  it('counts the separator', () => {
    expect(slugify('a b c', { maxLength: 3 })).toBe('a-b')
    expect(slugify('a b c', { maxLength: 4 })).toBe('a-b')
  })

  it('ignores a nonsense limit', () => {
    expect(slugify('a b', { maxLength: Number.NaN })).toBe('a-b')
    expect(slugify('a b', { maxLength: -3 })).toBe('a-b')
  })
})

describe('slugify: properties', () => {
  it('ascii output contains only a-z, 0-9 and single inner separators', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.constantFrom('-', '_', '.' as const), (s, sep) => {
        const out = slugify(s, { separator: sep })
        if (out === '') return
        const esc = sep === '.' ? '\\.' : sep
        expect(out).toMatch(new RegExp(`^[a-z0-9]+(?:${esc}[a-z0-9]+)*$`))
      }),
    )
  })

  it('respects maxLength', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.integer({ min: 1, max: 40 }), (s, max) => {
        expect([...slugify(s, { ascii: false, maxLength: max })].length).toBeLessThanOrEqual(max)
      }),
    )
  })

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (s) => {
        const once = slugify(s)
        expect(slugify(once)).toBe(once)
      }),
    )
  })
})
