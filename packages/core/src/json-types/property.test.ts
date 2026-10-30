import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { jsonTypes, type Target } from './convert.ts'
import { kindsOf } from './model.ts'
import { inferShape, type Shape } from './shape.ts'

const TARGETS: readonly Target[] = ['typescript', 'zod', 'go']

/** Does `shape` admit `value`? The invariant every emitter builds on. */
function matches(shape: Shape, value: unknown): boolean {
  if (shape.unknown) return true
  if (value === null) return shape.null
  switch (typeof value) {
    case 'string':
      return shape.string
    case 'boolean':
      return shape.boolean
    case 'number':
      return Number.isInteger(value) && !String(value).includes('e')
        ? shape.integer !== null || shape.number
        : shape.number
  }
  if (Array.isArray(value)) return shape.array !== null && value.every((v) => matches(shape.array!.items, v))
  if (typeof value !== 'object' || shape.object === null) return false
  const record = value as Record<string, unknown>
  const { kinds } = kindsOf(shape)
  if (!kinds.some((k) => k.k === 'object' || k.k === 'map')) return false
  return Object.keys(record).every((key) => {
    const field = shape.object!.fields.get(key)
    return field !== undefined && matches(field.shape, record[key])
  })
}

describe('jsonTypes: properties', () => {
  it('never throws, on any text', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...TARGETS), (text, target) => {
        jsonTypes(text, { target })
      }),
    )
  })

  it('turns any JSON into output with no errors', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.constantFrom(...TARGETS), (value, target) => {
        const r = jsonTypes(JSON.stringify(value), { target })
        expect(r.errors).toEqual([])
        expect(r.output).not.toBe('')
      }),
    )
  })

  it('infers a shape that admits every sample it saw', () => {
    fc.assert(
      fc.property(fc.array(fc.jsonValue(), { minLength: 1, maxLength: 5 }), (samples) => {
        const { shape } = inferShape(samples)
        for (const s of samples) expect(matches(shape, s)).toBe(true)
      }),
    )
  })
})

describe('jsonTypes: the output works', () => {
  const dir = mkdtempSync(join(tmpdir(), 'json-types-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const zodUrl = import.meta.resolve('zod')

  it('emits a Zod schema that parses the sample it came from', async () => {
    let n = 0
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (value) => {
        const text = JSON.stringify(value)
        // Without the inferred types the output is plain JavaScript.
        const { output } = jsonTypes(text, { target: 'zod', inferTypes: false })
        const file = join(dir, `schema${n++}.mjs`)
        writeFileSync(file, output.replace('from "zod"', `from ${JSON.stringify(zodUrl)}`))
        const mod = (await import(pathToFileURL(file).href)) as Record<string, { parse(v: unknown): unknown }>
        const schema = mod.rootListSchema ?? mod.rootSchema!
        schema.parse(JSON.parse(text))
      }),
      { numRuns: 150 },
    )
  })

  it('emits TypeScript that its own sample typechecks against', () => {
    const fixtures: string[] = [
      '{"big": 12345678901234567890, "f": 1.0, "e": []}',
      ...[
        { id: 1, name: 'a', tags: ['x'], meta: {}, deep: { a: [{ b: null }, { b: 1, c: 'x' }] } },
        [{ a: 1 }, { a: 'x', b: [1, 'a', null] }],
        [[{ x: 1 }], []],
        { 'foo-bar': 1, '': 2, '1st': 3, $ok: true, 'quote"d': 'x' },
        { users: [{ id: 1, role: null }, { id: 2, email: 'e' }] },
        'x',
        null,
        [1, 2],
        [],
        {},
        ...fc.sample(
          fc.jsonValue({ maxDepth: 4 }).filter((v) => !JSON.stringify(v).includes('"__proto__"')),
          { numRuns: 40, seed: 42 },
        ),
      ].map((v) => JSON.stringify(v)),
    ]
    fixtures.forEach((json, i) => {
      for (const declaration of ['interface', 'type'] as const) {
        const { output } = jsonTypes(json, { target: 'typescript', declaration })
        const root = output.includes('export type RootList ') ? 'RootList' : 'Root'
        writeFileSync(
          join(dir, `fixture${i}-${declaration}.ts`),
          `${output}\nexport const sample: ${root} = ${json};\n`,
        )
      }
    })
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, exactOptionalPropertyTypes: true, target: 'ES2023' },
        include: ['*.ts'],
      }),
    )
    const tsc = join(import.meta.dirname, '../../node_modules/.bin/tsc')
    try {
      execFileSync(tsc, ['-p', dir], { encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      const err = e as { stdout?: string }
      throw new Error(`tsc rejected the emitted types:\n${err.stdout ?? String(e)}`, { cause: e })
    }
  }, 60_000)
})
