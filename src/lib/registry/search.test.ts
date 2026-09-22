import { describe, expect, it } from 'vitest'
import { TOOLS_BY_SLUG } from './index'
import { scoreTool, searchTools } from './search'

describe('searchTools', () => {
  it('returns everything for an empty query', () => {
    expect(searchTools('').length).toBeGreaterThan(0)
    expect(searchTools('   ').length).toBe(searchTools('').length)
  })

  it('ranks an exact slug first', () => {
    expect(searchTools('diff')[0]?.slug).toBe('diff')
    expect(searchTools('json')[0]?.slug).toBe('json')
  })

  it('finds a tool by a competitor name in its keywords', () => {
    expect(searchTools('diffchecker')[0]?.slug).toBe('diff')
  })

  it('finds a tool by an alias the title does not contain', () => {
    expect(searchTools('uniq')[0]?.slug).toBe('list')
    expect(searchTools('btoa')[0]?.slug).toBe('base64')
  })

  it('matches title initials', () => {
    expect(searchTools('jf')[0]?.slug).toBe('json')
  })

  it('is case insensitive', () => {
    expect(searchTools('JSON')[0]?.slug).toBe('json')
  })

  it('excludes non-matches entirely', () => {
    expect(searchTools('zzzzznope')).toEqual([])
  })
})

describe('scoreTool', () => {
  it('scores an exact slug above a keyword substring', () => {
    const diff = TOOLS_BY_SLUG.diff
    expect(scoreTool(diff, 'diff')).toBeGreaterThan(scoreTool(diff, 'patch'))
  })

  it('gives every tool a positive score for an empty query', () => {
    for (const tool of Object.values(TOOLS_BY_SLUG)) {
      expect(scoreTool(tool, '')).toBeGreaterThan(0)
    }
  })
})
