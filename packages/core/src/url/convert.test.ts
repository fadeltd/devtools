import { describe, expect, it } from 'vitest'
import { convert, type ConvertOptions } from './convert.ts'

const ENC: ConvertOptions = { mode: 'encode', variant: 'component', lenient: false }
const DEC: ConvertOptions = { mode: 'decode', variant: 'component', lenient: false }

const kinds = (r: ReturnType<typeof convert>) => r.warnings.map((w) => w.kind)

describe('convert', () => {
  it('is empty for empty input', () => {
    expect(convert('', ENC)).toEqual({ output: '', error: null, warnings: [] })
  })

  it('encodes and decodes per variant', () => {
    expect(convert('a b', { ...ENC, variant: 'form' }).output).toBe('a+b')
    expect(convert('a+b', { ...DEC, variant: 'form' }).output).toBe('a b')
    expect(convert('https://x.dev/a b', { ...ENC, variant: 'uri' }).output).toBe('https://x.dev/a%20b')
    expect(convert('a%2Fb%20c', { ...DEC, variant: 'uri' }).output).toBe('a%2Fb c')
  })

  it('returns an error, not a throw, for a lone surrogate', () => {
    const r = convert('x\uD83D', ENC)
    expect(r.output).toBe('')
    expect(r.error?.index).toBe(1)
  })

  it('returns the first malformed sequence in strict mode', () => {
    const r = convert('ok%E2%82', DEC)
    expect(r.error).toMatchObject({ index: 2, sequence: '%E2%82' })
  })

  it('in lenient mode, decodes the rest and warns how many were skipped', () => {
    const r = convert('a%20%FF%G1', { ...DEC, lenient: true })
    expect(r.output).toBe('a %FF%G1')
    expect(kinds(r)).toEqual(['skipped'])
    expect(r.warnings[0]?.message).toContain('2 malformed sequences')
    expect(r.warnings[0]?.message).toContain('position 5')
  })

  it('says so when decoding double-encoded input', () => {
    const r = convert('a%2520b', DEC)
    expect(r.output).toBe('a%20b')
    expect(kinds(r)).toEqual(['double-encoded'])
    expect(r.warnings[0]?.message).toContain('%2520')
  })

  it('warns before encoding input that is already encoded', () => {
    const r = convert('a%20b', ENC)
    expect(r.output).toBe('a%2520b')
    expect(kinds(r)).toEqual(['already-encoded'])
  })

  it('points out a literal + outside form mode', () => {
    expect(kinds(convert('a+b', DEC))).toEqual(['plus-kept'])
    expect(kinds(convert('a+b', { ...DEC, variant: 'form' }))).toEqual([])
  })

  it('has nothing to say about clean input', () => {
    expect(convert('hello world', ENC).warnings).toEqual([])
    expect(convert('hello%20world', DEC).warnings).toEqual([])
  })
})
