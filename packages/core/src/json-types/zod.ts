import { isOptional, kindsOf, type Decl, type Kind, type Model } from './model.ts'
import type { NoteSink } from './notes.ts'
import { pathKey, type Shape } from './shape.ts'
import { isPlainKey, noteBigInteger, noteEmptyArray } from './typescript.ts'

export interface ZodOptions {
  /** Also export `type X = z.infer<typeof xSchema>` for every schema. */
  inferTypes: boolean
}

function schemaName(typeName: string): string {
  const chars = [...typeName]
  return `${chars[0]!.toLowerCase()}${chars.slice(1).join('')}Schema`
}

/**
 * A key inside `z.object({ … })`. `__proto__` must be computed: written plainly
 * or quoted, an object literal sets the prototype instead of adding the key.
 */
function objectKey(key: string): string {
  if (key === '__proto__') return '["__proto__"]'
  return isPlainKey(key) ? key : JSON.stringify(key)
}

/**
 * Only syntax that Zod 3 and Zod 4 read the same way. Schemas are written
 * children first, because a `const` can't be used before its declaration.
 */
export function emitZod(model: Model, o: ZodOptions, notes: NoteSink): string {
  function expr(s: Shape, path: string): string {
    const { kinds, nullable } = kindsOf(s)
    if (kinds.length === 0) return nullable ? 'z.null()' : 'z.unknown()'
    const parts = kinds.map((k) => kindExpr(k, path))
    const base = parts.length === 1 ? parts[0]! : `z.union([${parts.join(', ')}])`
    // z.unknown() already accepts null.
    return nullable && kinds[0]!.k !== 'unknown' ? `${base}.nullable()` : base
  }

  function kindExpr(k: Kind, path: string): string {
    switch (k.k) {
      case 'unknown':
        return 'z.unknown()'
      case 'object':
        return schemaName(model.declOf(k.object).name)
      case 'map':
        return 'z.record(z.string(), z.unknown())'
      case 'array':
        if (kindsOf(k.items).kinds.length === 0 && !k.items.null) noteEmptyArray(notes, path)
        return `z.array(${expr(k.items, `${path}[]`)})`
      case 'string':
        return 'z.string()'
      case 'integer':
        if (k.range === 'safe') return 'z.number().int()'
        noteBigInteger(
          notes,
          path,
          'Zod 4’s .int() rejects them, so this is a plain z.number(); validate it as a string instead if the digits matter.',
        )
        return 'z.number()'
      case 'number':
        return 'z.number()'
      case 'boolean':
        return 'z.boolean()'
    }
  }

  const blocks: string[] = []
  const done = new Set<Decl>()

  /** Every named object `s` refers to, through arrays and unions. */
  function referenced(s: Shape, out: Decl[]): void {
    for (const k of kindsOf(s).kinds) {
      if (k.k === 'object') out.push(model.declOf(k.object))
      else if (k.k === 'array') referenced(k.items, out)
    }
  }

  function emit(decl: Decl): void {
    if (done.has(decl)) return
    done.add(decl)
    const children: Decl[] = []
    for (const field of decl.object.fields.values()) referenced(field.shape, children)
    for (const child of children) emit(child)

    const lines = [...decl.object.fields].map(([key, field]) => {
      const optional = isOptional(decl.object, key) ? '.optional()' : ''
      return `  ${objectKey(key)}: ${expr(field.shape, `${decl.path}${pathKey(key)}`)}${optional},`
    })
    const name = schemaName(decl.name)
    blocks.push(
      `export const ${name} = z.object({\n${lines.join('\n')}\n});` +
        (o.inferTypes ? `\nexport type ${decl.name} = z.infer<typeof ${name}>;` : ''),
    )
  }

  for (const decl of model.decls) emit(decl)

  if (model.alias !== null) {
    const name = schemaName(model.alias.name)
    blocks.push(
      `export const ${name} = ${expr(model.alias.shape, '.')};` +
        (o.inferTypes ? `\nexport type ${model.alias.name} = z.infer<typeof ${name}>;` : ''),
    )
  }

  return `import { z } from "zod";\n\n${blocks.join('\n\n')}\n`
}
