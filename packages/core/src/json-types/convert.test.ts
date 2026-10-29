import { describe, expect, it } from 'vitest'
import { jsonTypes } from './convert.ts'
import { MAX_NOTES } from './notes.ts'

describe('jsonTypes: reading input', () => {
  it('returns nothing for blank input', () => {
    expect(jsonTypes('  \n', { target: 'go' })).toEqual({
      output: '',
      errors: [],
      notes: [],
      flavor: 'empty',
      samples: 0,
      types: 0,
    })
  })

  it('reports invalid JSON with a position, and no output', () => {
    const r = jsonTypes('{\n  "a": 1\n  "b": 2\n}', { target: 'typescript' })
    expect(r.output).toBe('')
    expect(r.flavor).toBe('invalid')
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.errors[0]).toMatchObject({ line: 3 })
  })

  it('accepts comments and trailing commas', () => {
    const r = jsonTypes('{\n  // the id\n  "id": 1.0,\n}', { target: 'go' })
    expect(r.flavor).toBe('jsonc')
    expect(r.output).toContain('ID float64')
  })

  it('reads NDJSON lines as samples of one root', () => {
    const r = jsonTypes('{"a":1}\n{"a":2,"b":"x"}\n{"a":null}\n', { target: 'typescript' })
    expect(r.flavor).toBe('ndjson')
    expect(r.samples).toBe(3)
    expect(r.output).toBe('export interface Root {\n  a: number | null;\n  b?: string;\n}\n')
  })

  it('counts the types it wrote', () => {
    expect(jsonTypes('[{"a":{"b":1}}]', { target: 'typescript' }).types).toBe(3)
    expect(jsonTypes('1', { target: 'typescript' }).types).toBe(1)
  })
})

describe('jsonTypes: notes', () => {
  it('notes the depth cap', () => {
    const r = jsonTypes(`${'['.repeat(300)}${']'.repeat(300)}`, { target: 'typescript' })
    expect(r.notes.map((n) => n.code)).toContain('depth')
  })

  it('notes empty arrays once per place', () => {
    const r = jsonTypes('[{"a":[]},{"a":[]}]', { target: 'typescript' })
    expect(r.notes).toEqual([
      { code: 'empty-array', path: '.[].a', message: expect.stringContaining('empty') },
    ])
  })

  it('caps the notes with one summary', () => {
    const wide = Object.fromEntries(Array.from({ length: MAX_NOTES + 20 }, (_, i) => [`k${i}`, []]))
    const r = jsonTypes(JSON.stringify(wide), { target: 'typescript' })
    expect(r.notes).toHaveLength(MAX_NOTES + 1)
    expect(r.notes.at(-1)).toMatchObject({ code: 'more', message: '…and 20 more notes like these.' })
  })
})
