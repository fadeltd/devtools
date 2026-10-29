import { describe, expect, it } from 'vitest'
import { safeFilenameLines, slugifyLines } from './lines.ts'

describe('slugifyLines', () => {
  it('slugs each line', () => {
    const r = slugifyLines('Hello World\nCrème Brûlée')
    expect(r.output).toBe('hello-world\ncreme-brulee')
    expect(r.lines).toBe(2)
    expect(r.empty).toBe(0)
  })

  it('does not invent a phantom line from a trailing newline', () => {
    expect(slugifyLines('a\nb\n').output).toBe('a\nb\n')
  })

  it('never leaves a \\r glued on, and keeps CRLF', () => {
    expect(slugifyLines('Foo Bar\r\nBaz\r\n').output).toBe('foo-bar\r\nbaz\r\n')
  })

  it('keeps blank lines blank so output stays aligned', () => {
    const r = slugifyLines('a\n\n  \nb')
    expect(r.output).toBe('a\n\n\nb')
    expect(r.lines).toBe(2)
  })

  it('counts lines that had nothing to slug', () => {
    const r = slugifyLines('ok\n🎉\n!!!')
    expect(r.output).toBe('ok\n\n')
    expect(r.empty).toBe(2)
  })

  it('passes options through', () => {
    expect(slugifyLines('a b\nc d', { separator: '_' }).output).toBe('a_b\nc_d')
  })

  it('handles empty input', () => {
    expect(slugifyLines('')).toEqual({ output: '', lines: 0, empty: 0 })
  })
})

describe('safeFilenameLines', () => {
  it('cleans each line and summarises the changes', () => {
    const r = safeFilenameLines('ok.txt\nCON.txt\na:b?.md\nnotes. \n')
    expect(r.output).toBe('ok.txt\n_CON.txt\na_b_.md\nnotes\n')
    expect(r.summary).toEqual({
      lines: 4,
      changed: 3,
      removedChars: 2,
      trimmed: 1,
      reserved: 1,
      truncated: 0,
      fallback: 0,
    })
  })

  it('keeps blank lines blank instead of naming them untitled', () => {
    const r = safeFilenameLines('a\n\nb')
    expect(r.output).toBe('a\n\nb')
    expect(r.summary.fallback).toBe(0)
  })

  it('splits on CRLF without leaving \\r behind', () => {
    expect(safeFilenameLines('a\r\nb\r\n').output).toBe('a\r\nb\r\n')
  })

  it('counts truncations and fallbacks', () => {
    const r = safeFilenameLines(`${'x'.repeat(300)}\n...`)
    expect(r.summary.truncated).toBe(1)
    expect(r.summary.fallback).toBe(1)
    expect(r.output.split('\n')[1]).toBe('untitled')
  })
})
