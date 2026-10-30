import { isOptional, kindsOf, type Kind, type Model } from './model.ts'
import type { NoteSink } from './notes.ts'
import { pathKey, type Shape } from './shape.ts'

export interface TypeScriptOptions {
  /** `interface Root { … }` or `type Root = { … }`. */
  declaration: 'interface' | 'type'
}

/** A property name that needs no quotes. */
export function isPlainKey(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
}

export function propertyKey(key: string): string {
  return isPlainKey(key) ? key : JSON.stringify(key)
}

export function noteBigInteger(notes: NoteSink, path: string, also: string): void {
  notes.add(
    'big-integer',
    path,
    `Holds integers beyond 2^53, which a JavaScript number rounds. ${also}`,
  )
}

export function noteEmptyArray(notes: NoteSink, path: string): void {
  notes.add('empty-array', path, 'Every sample of this array was empty, so its element type is unknown.')
}

export function emitTypeScript(model: Model, o: TypeScriptOptions, notes: NoteSink): string {
  function expr(s: Shape, path: string): string {
    const { kinds, nullable } = kindsOf(s)
    if (kinds.length === 0) return nullable ? 'null' : 'unknown'
    const parts = kinds.map((k) => kindExpr(k, path))
    if (nullable) parts.push('null')
    return parts.join(' | ')
  }

  function kindExpr(k: Kind, path: string): string {
    switch (k.k) {
      case 'unknown':
        return 'unknown'
      case 'object':
        return model.declOf(k.object).name
      case 'map':
        return 'Record<string, unknown>'
      case 'array': {
        const itemPath = `${path}[]`
        if (kindsOf(k.items).kinds.length === 0 && !k.items.null) noteEmptyArray(notes, path)
        const items = expr(k.items, itemPath)
        return items.includes(' | ') ? `(${items})[]` : `${items}[]`
      }
      case 'string':
        return 'string'
      case 'integer':
        if (k.range !== 'safe') noteBigInteger(notes, path, 'Read it as a string or a BigInt instead.')
        return 'number'
      case 'number':
        return 'number'
      case 'boolean':
        return 'boolean'
    }
  }

  const blocks: string[] = []
  if (model.alias !== null) {
    blocks.push(`export type ${model.alias.name} = ${expr(model.alias.shape, '.')};`)
  }
  for (const decl of model.decls) {
    const lines = [...decl.object.fields].map(([key, field]) => {
      const optional = isOptional(decl.object, key) ? '?' : ''
      return `  ${propertyKey(key)}${optional}: ${expr(field.shape, `${decl.path}${pathKey(key)}`)};`
    })
    const body = `{\n${lines.join('\n')}\n}`
    blocks.push(
      o.declaration === 'interface'
        ? `export interface ${decl.name} ${body}`
        : `export type ${decl.name} = ${body};`,
    )
  }
  return `${blocks.join('\n\n')}\n`
}
