import { describe, expect, it } from 'vitest'
import { findFilenameCollisions, safeFilenameLines, slugifyLines } from './lines.ts'

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

describe('filename collisions', () => {
  it('reports names that differ only by case as 1-based line groups', () => {
    const r = safeFilenameLines('a.txt\nReport.pdf\nb.txt\n\nc.txt\nd.txt\nREPORT.pdf')
    expect(r.collisions).toEqual({ exact: [], caseOnly: [[2, 7]] })
  })

  it('reports exact duplicates separately', () => {
    const r = safeFilenameLines('x\ny\nx\ny\ny')
    expect(r.collisions).toEqual({ exact: [[1, 3], [2, 4, 5]], caseOnly: [] })
  })

  it('lists an exact repeat inside a case group in both', () => {
    const r = safeFilenameLines('a\nA\na')
    expect(r.collisions.exact).toEqual([[1, 3]])
    expect(r.collisions.caseOnly).toEqual([[1, 2, 3]])
  })

  it('compares the cleaned names, not the input', () => {
    // Both become "a_b.txt" once ":" and "?" are replaced.
    const r = safeFilenameLines('a:b.txt\na?b.txt\nA_B.TXT')
    expect(r.output).toBe('a_b.txt\na_b.txt\nA_B.TXT')
    expect(r.collisions).toEqual({ exact: [[1, 2]], caseOnly: [[1, 2, 3]] })
  })

  it('counts fallback names: two lines with nothing usable are both untitled', () => {
    expect(safeFilenameLines('...\n....').collisions.exact).toEqual([[1, 2]])
  })

  it('ignores blank lines but keeps their line numbers', () => {
    expect(safeFilenameLines('a\n\n\nA').collisions.caseOnly).toEqual([[1, 4]])
  })

  it('folds non-ASCII case', () => {
    expect(findFilenameCollisions(['Ünïcode', 'ünÏCODE']).caseOnly).toEqual([[1, 2]])
  })

  it('treats composed and decomposed forms as one name, as APFS does', () => {
    const composed = 'caf\u00e9'
    const decomposed = 'cafe\u0301'
    expect(findFilenameCollisions([composed, decomposed])).toEqual({ exact: [], caseOnly: [[1, 2]] })
  })

  it('does not merge ß with ss: filesystems use simple case mapping', () => {
    expect(findFilenameCollisions(['straße', 'STRASSE']).caseOnly).toEqual([])
  })

  it('reports nothing for distinct names', () => {
    expect(safeFilenameLines('a\nb\nc').collisions).toEqual({ exact: [], caseOnly: [] })
    expect(safeFilenameLines('').collisions).toEqual({ exact: [], caseOnly: [] })
  })
})
