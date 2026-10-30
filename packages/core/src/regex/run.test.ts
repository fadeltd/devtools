import { describe, expect, it } from 'vitest'
import { runRegex } from './run.ts'

const base = { pattern: '(\\w)+', flags: 'g', text: 'ab cd', mode: 'match' as const, replacement: '' }

describe('runRegex', () => {
  it('matches in match mode', () => {
    const r = runRegex(base)
    expect(r.ok && r.match?.matches.map((m) => m.text)).toEqual(['ab', 'cd'])
    expect(r.ok && r.replace).toBeNull()
  })

  it('replaces in replace mode, with issues', () => {
    const r = runRegex({ ...base, mode: 'replace', replacement: '<$1$2>' })
    expect(r.ok && r.match).toBeNull()
    expect(r.ok && r.replace).toEqual({
      output: '<b$2> <d$2>',
      count: 2,
      issues: [{ ref: '$2', message: '$2 is inserted as written: the pattern has 1 capture group.' }],
    })
  })

  it('returns a bad pattern or flags as data', () => {
    expect(runRegex({ ...base, pattern: '[' })).toMatchObject({ ok: false, kind: 'pattern' })
    expect(runRegex({ ...base, flags: 'gg' })).toMatchObject({ ok: false, kind: 'flags' })
  })
})
