import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { jsonTypes } from './convert.ts'

function hasGo(): boolean {
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Runs only where a Go toolchain exists (GitHub's Ubuntu runners have one).
 * gofmt must find nothing to change, and every sample must decode into the
 * struct generated from it with unknown fields disallowed -- which catches a
 * wrong tag, an int64 that should be float64, and a missing field.
 */
describe.skipIf(!hasGo())('go: the output compiles, is gofmt-clean and decodes its sample', () => {
  const dir = mkdtempSync(join(tmpdir(), 'json-types-go-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('decodes', () => {
    const fixtures: string[] = [
      // Literals a double can't hold, so they stay text: uint64, past uint64, and 1.0.
      '{"big": 12345678901234567890, "huge": 123456789012345678901234567890, "f": 1.0, "e": 1e21}',
      ...[
        { id: 1, user_id: 2, userId: 3, price: 1.5, tags: ['x'], meta: { k: 1 }, empty: [] },
        [{ a: 1, n: null }, { a: 2, b: 'x', n: 'y' }],
        { orders: [{ id: 1, items: [{ sku: 'a', qty: 1 }] }, { id: 2, items: [] }] },
        { nested: [[1, 2], [3]], mixed: [1, 'a', null], deep: { a: { b: { c: true } } } },
        { 名前: 'x', 'foo-bar': 1, '1st': 2 },
        'x',
        [1, 2],
        {},
        ...fc.sample(fc.jsonValue({ maxDepth: 4 }), { numRuns: 60, seed: 7 }),
      ].map((v) => JSON.stringify(v)),
    ]

    const imports: string[] = []
    const pkgs: string[] = []
    const calls: string[] = []
    let used = 0
    fixtures.forEach((json, i) => {
      const r = jsonTypes(json, { target: 'go' })
      // A skipped (json:"-") key is reported, and DisallowUnknownFields would
      // rightly reject it; those cases are covered by the unit tests.
      if (r.notes.some((n) => n.code === 'bad-go-tag')) return
      used++
      const root = r.output.startsWith('type RootList ') ? 'RootList' : 'Root'
      const pkg = `f${i}`
      pkgs.push(pkg)
      mkdirSync(join(dir, pkg))
      writeFileSync(join(dir, pkg, 'types.go'), `package ${pkg}\n\n${r.output}`)
      writeFileSync(
        join(dir, pkg, 'check.go'),
        `package ${pkg}

import (
\t"bytes"
\t"encoding/json"
)

const sample = ${JSON.stringify(json)}

func Check() error {
\tdec := json.NewDecoder(bytes.NewReader([]byte(sample)))
\tdec.DisallowUnknownFields()
\tvar v ${root}
\treturn dec.Decode(&v)
}
`,
      )
      imports.push(`\t"check/${pkg}"`)
      calls.push(`\tif err := ${pkg}.Check(); err != nil {\n\t\tfmt.Println("${pkg}:", err)\n\t\tfailed = true\n\t}`)
    })
    expect(used).toBeGreaterThan(40)

    writeFileSync(join(dir, 'go.mod'), 'module check\n\ngo 1.22\n')
    writeFileSync(
      join(dir, 'main.go'),
      `package main\n\nimport (\n\t"fmt"\n\t"os"\n\n${imports.join('\n')}\n)\n\nfunc main() {\n\tfailed := false\n${calls.join('\n')}\n\tif failed {\n\t\tos.Exit(1)\n\t}\n}\n`,
    )

    const unformatted = execFileSync('gofmt', ['-l', ...pkgs], { cwd: dir, encoding: 'utf8' })
    expect(unformatted).toBe('')
    try {
      execFileSync('go', ['run', '.'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string }
      throw new Error(`Go rejected the output:\n${err.stdout ?? ''}${err.stderr ?? String(e)}`, { cause: e })
    }
  }, 120_000)
})
