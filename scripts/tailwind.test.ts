import { describe, expect, it } from 'vitest'
import { applyFindings, findInSource, findNonCanonical } from './tailwind'

// A stand-in canonicalizer, so the extraction tests don't depend on Tailwind.
const fake = (token: string) => ({ 'w-[220px]': 'w-55', 'rounded-[2px]': 'rounded-xs' })[token] ?? token

describe('findInSource', () => {
  it('finds classes in className strings, cn() arguments and template literals', () => {
    const src = [
      `const a = <div className="flex w-[220px]" />`,
      `const b = cn('p-2', on && 'rounded-[2px]')`,
      'const c = `gap-2 ${x} w-[220px]`',
    ].join('\n')
    const found = findInSource('x.tsx', src, fake)
    expect(found.map((f) => [f.line, f.from, f.to])).toEqual([
      [1, 'w-[220px]', 'w-55'],
      [2, 'rounded-[2px]', 'rounded-xs'],
      [3, 'w-[220px]', 'w-55'],
    ])
  })

  it('ignores JSX text, so an apostrophe cannot open a fake string', () => {
    const src = `const a = <p>Don't w-[220px] it's fine</p>`
    expect(findInSource('x.tsx', src, fake)).toEqual([])
  })

  it('reports offsets that applyFindings can rewrite exactly', () => {
    const src = `<a className="w-[220px] x rounded-[2px]" b="w-[220px]" />`
    const out = applyFindings(src, findInSource('x.tsx', src, fake))
    expect(out).toBe(`<a className="w-55 x rounded-xs" b="w-55" />`)
  })
})

describe('src/', () => {
  // The guard: new code must use the canonical spelling. Run `pnpm tw:fix --write`.
  it('has no non-canonical Tailwind classes', { timeout: 60_000 }, async () => {
    const findings = await findNonCanonical()
    expect(findings.map((f) => `${f.file}:${f.line}  ${f.from} → ${f.to}`)).toEqual([])
  })
})
