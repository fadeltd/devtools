import { describe, expect, it } from 'vitest'
import { checkColors, contrastRatio, normalizeHex } from './color.ts'

describe('normalizeHex', () => {
  it.each([
    ['#000', '#000000'],
    ['#ABCDEF', '#abcdef'],
    ['fff', '#ffffff'],
    ['  #123456 ', '#123456'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeHex(input)).toBe(expected)
  })

  it.each(['', '#', '#12', '#1234', '#12345678', 'red', '#ggg'])('rejects %j', (input) => {
    expect(normalizeHex(input)).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5)
    expect(contrastRatio({ r: 10, g: 200, b: 30 }, { r: 10, g: 200, b: 30 })).toBe(1)
  })
})

describe('checkColors', () => {
  it('passes black on white with no warnings', () => {
    expect(checkColors('#000', '#fff')).toMatchObject({
      ok: true,
      foreground: '#000000',
      background: '#ffffff',
      warnings: [],
    })
  })

  it('warns on low contrast', () => {
    const r = checkColors('#777777', '#888888')
    expect(r.ok && r.warnings.some((w) => w.startsWith('Low contrast'))).toBe(true)
  })

  it('warns on an inverted code even at full contrast', () => {
    const r = checkColors('#ffffff', '#000000')
    expect(r.ok && r.warnings).toHaveLength(1)
    expect(r.ok && r.warnings[0]).toMatch(/inverted/)
  })

  it('names the invalid field', () => {
    expect(checkColors('nope', '#fff')).toMatchObject({ ok: false, field: 'foreground' })
    expect(checkColors('#000', 'nope')).toMatchObject({ ok: false, field: 'background' })
  })
})
