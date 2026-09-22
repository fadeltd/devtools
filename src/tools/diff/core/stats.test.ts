import { describe, expect, it } from 'vitest'
import { diff } from '@codemirror/merge'
import { assessSize, diffStats, formatStats } from './stats'

const statsOf = (a: string, b: string) => diffStats(a, b, diff(a, b))

describe('diffStats', () => {
  it('reports identical input', () => {
    const s = statsOf('same\ntext\n', 'same\ntext\n')
    expect(s.identical).toBe(true)
    expect(formatStats(s)).toBe('identical')
  })

  it('counts a pure addition', () => {
    const s = statsOf('a\nb\n', 'a\nb\nc\n')
    expect(s.addedLines).toBe(1)
    expect(s.removedLines).toBe(0)
    expect(s.changedLines).toBe(0)
  })

  it('counts a pure removal', () => {
    const s = statsOf('a\nb\nc\n', 'a\nc\n')
    expect(s.removedLines).toBe(1)
    expect(s.addedLines).toBe(0)
  })

  it('counts a modification as changed, not as add plus remove', () => {
    const s = statsOf('hello\n', 'hallo\n')
    expect(s.changedLines).toBe(1)
    expect(s.addedLines).toBe(0)
    expect(s.removedLines).toBe(0)
  })

  it('counts characters on both sides', () => {
    const s = statsOf('abc', 'abcdef')
    expect(s.addedChars).toBeGreaterThan(0)
    expect(s.removedChars).toBe(0)
  })

  it('reports chunk count', () => {
    const s = statsOf('a\nb\nc\nd\n', 'a\nX\nc\nY\n')
    expect(s.chunks).toBeGreaterThanOrEqual(2)
  })

  it('handles an empty side', () => {
    const added = statsOf('', 'a\nb\n')
    expect(added.addedLines).toBeGreaterThan(0)
    expect(added.removedLines).toBe(0)

    const removed = statsOf('a\nb\n', '')
    expect(removed.removedLines).toBeGreaterThan(0)
    expect(removed.addedLines).toBe(0)
  })

  it('handles both sides empty', () => {
    expect(statsOf('', '').identical).toBe(true)
  })
})

describe('formatStats', () => {
  it('formats a mixed diff', () => {
    expect(
      formatStats({
        addedLines: 3,
        removedLines: 2,
        changedLines: 1,
        addedChars: 0,
        removedChars: 0,
        chunks: 1,
        identical: false,
      }),
    ).toBe('+3 −2 ~1')
  })

  it('omits zero components', () => {
    expect(
      formatStats({
        addedLines: 3,
        removedLines: 0,
        changedLines: 0,
        addedChars: 0,
        removedChars: 0,
        chunks: 1,
        identical: false,
      }),
    ).toBe('+3')
  })
})

describe('assessSize', () => {
  it('passes normal input', () => {
    expect(assessSize('a\nb', 'a\nc').tier).toBe('ok')
  })

  it('measures the longest line', () => {
    expect(assessSize('short\n' + 'x'.repeat(500), '').longestLine).toBe(500)
  })

  it('degrades to line-only highlighting over 2 MB', () => {
    const big = 'line\n'.repeat(500_000)
    expect(assessSize(big, '').tier).toBe('line-only')
  })

  it('refuses a single enormous line', () => {
    // CodeMirror copes with a 5MB document but not a 5MB single line.
    const v = assessSize('x'.repeat(250_000), '')
    expect(v.tier).toBe('refuse')
    expect(v.reason).toContain('characters long')
  })

  it('refuses input over 8 MB with an actionable reason', () => {
    const v = assessSize('a\n'.repeat(5_000_000), '')
    expect(v.tier).toBe('refuse')
    expect(v.reason).toContain('git diff')
  })
})
