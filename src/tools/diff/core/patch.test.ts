import fc from 'fast-check'
import { applyPatch } from 'diff'
import { describe, expect, it } from 'vitest'
import { toUnifiedPatch } from './patch'

const lineArb = fc.string({ unit: fc.constantFrom('a', 'b', 'A', ' ', '\t', 'x'), maxLength: 6 })
const docArb = fc
  .array(fc.tuple(lineArb, fc.constantFrom('\n', '\r\n', '')), { maxLength: 12 })
  .map((parts) => parts.map(([line, end]) => line + end).join(''))

describe('toUnifiedPatch', () => {
  it('writes file headers and a hunk, with no index banner', () => {
    expect(toUnifiedPatch('x\ny', 'x\nz\n')).toBe(
      '--- a\n+++ b\n@@ -1,2 +1,2 @@\n x\n-y\n\\ No newline at end of file\n+z\n',
    )
  })

  it('has no hunks for identical input', () => {
    expect(toUnifiedPatch('same\n', 'same\n')).not.toContain('@@')
  })

  it('reproduces b byte for byte across a CRLF/LF difference', () => {
    const a = 'a\r\nb\r\n'
    const b = 'a\nb\n'
    expect(applyPatch(a, toUnifiedPatch(a, b)!)).toBe(b)
  })

  it('applying the patch to a always yields b', () => {
    fc.assert(
      fc.property(docArb, docArb, (a, b) => {
        expect(applyPatch(a, toUnifiedPatch(a, b)!)).toBe(b)
      }),
    )
  })

  it('builds a patch for thousands of scattered edits as fast as the view diffs them', () => {
    const base = Array.from({ length: 5000 }, (_, i) => `line ${i} alpha beta\n`)
    const a = base.join('')
    const b = base.map((l, i) => (i % 2 ? l.replace('beta', 'BETA') : l)).join('')
    const started = Date.now()
    const patch = toUnifiedPatch(a, b)
    expect(Date.now() - started).toBeLessThan(250)
    expect(applyPatch(a, patch!)).toBe(b)
  })

  it('merges changes closer than twice the context into one hunk', () => {
    const a = 'a\nb\nc\nd\ne\nf\ng\nh\ni\n'
    const b = 'a\nB\nc\nd\ne\nf\ng\nH\ni\n'
    expect(toUnifiedPatch(a, b)!.match(/^@@/gm)).toHaveLength(1)
    const far = 'a\n' + 'x\n'.repeat(7) + 'b\n'
    expect(toUnifiedPatch(far, far.replace('a', 'A').replace('b\n', 'B\n'))!.match(/^@@/gm)).toHaveLength(2)
  })

  it('returns null instead of hanging when the line diff cannot finish in time', () => {
    const a = Array.from({ length: 40_000 }, (_, i) => `v${i % 500}\n`).join('')
    const b = Array.from({ length: 40_000 }, (_, i) => `v${(i * 37) % 500}\n`).join('')
    expect(toUnifiedPatch(a, b)).toBeNull()
  })
})
