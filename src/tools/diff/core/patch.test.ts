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

  it('returns null instead of hanging when the inputs are too different', () => {
    const a = Array.from({ length: 40_000 }, (_, i) => `x${i}\n`).join('')
    const b = Array.from({ length: 40_000 }, (_, i) => `y${i}\n`).join('')
    expect(toUnifiedPatch(a, b, 20)).toBeNull()
  })
})
