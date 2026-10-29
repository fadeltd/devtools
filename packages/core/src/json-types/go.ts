import { identifier, isOptional, kindsOf, wordsOf, type Kind, type Model } from './model.ts'
import type { NoteSink } from './notes.ts'
import { pathKey, type Shape } from './shape.ts'
import { noteEmptyArray } from './typescript.ts'

export interface GoOptions {
  /**
   * Optional and nullable fields become `*T`, so "absent" and "null" are told
   * apart from the zero value. Off, they decode to `""`, `0` or `false`.
   */
  pointers: boolean
}

/**
 * What `encoding/json` accepts as a tag name (its `isValidTag`). Anything else
 * -- a comma, a quote, a backslash, an empty key -- falls back to the field
 * name, so the key can't be mapped by a tag at all.
 */
function isValidTagName(key: string): boolean {
  if (key === '') return false
  for (const c of key) {
    if ('!#$%&()*+-./:;<=>?@[]^_{|}~ '.includes(c)) continue
    if (!/[\p{L}\p{Nd}]/u.test(c)) return false
  }
  return true
}

/** gofmt's column width counts runes, not UTF-16 units. */
function width(s: string): number {
  return [...s].length
}

export function emitGo(model: Model, o: GoOptions, notes: NoteSink): string {
  /** `nilable`: the type itself can hold nil, so a pointer would add nothing. */
  function expr(s: Shape, path: string): { type: string; nilable: boolean } {
    const { kinds, nullable } = kindsOf(s)
    if (kinds.length === 0) {
      if (nullable) notes.add('always-null', path, 'Only ever null in the samples, so it is typed as any.')
      else noteEmptyArray(notes, path.replace(/\[\]$/, ''))
      return { type: 'any', nilable: true }
    }
    if (kinds.length > 1) {
      notes.add(
        'mixed-types',
        path,
        `Holds ${kinds.map((k) => k.k).join(' and ')}, which Go can't express as one type, so it is any.`,
      )
      return { type: 'any', nilable: true }
    }
    return kindExpr(kinds[0]!, path)
  }

  function kindExpr(k: Kind, path: string): { type: string; nilable: boolean } {
    switch (k.k) {
      case 'unknown':
        return { type: 'any', nilable: true }
      case 'object':
        return { type: model.declOf(k.object).name, nilable: false }
      case 'map':
        return { type: 'map[string]any', nilable: true }
      case 'array': {
        const item = expr(k.items, `${path}[]`)
        const pointer = o.pointers && k.items.null && !item.nilable ? '*' : ''
        return { type: `[]${pointer}${item.type}`, nilable: true }
      }
      case 'string':
        return { type: 'string', nilable: false }
      case 'integer':
        if (k.range === 'uint64') return { type: 'uint64', nilable: false }
        if (k.range === 'big') {
          notes.add(
            'big-integer',
            path,
            'Holds integers beyond uint64, so it is float64, which rounds them. Use json.Number to keep the digits.',
          )
          return { type: 'float64', nilable: false }
        }
        return { type: 'int64', nilable: false }
      case 'number':
        return { type: 'float64', nilable: false }
      case 'boolean':
        return { type: 'bool', nilable: false }
    }
  }

  const blocks: string[] = []

  if (model.alias !== null) {
    blocks.push(`type ${model.alias.name} ${expr(model.alias.shape, '').type}`)
  }

  for (const decl of model.decls) {
    const used = new Set<string>()
    const rows = [...decl.object.fields].map(([key, field]) => {
      const path = `${decl.path}${pathKey(key)}`
      const base = identifier(wordsOf(key), 'go', 'Field')
      let name = base
      for (let n = 2; used.has(name); n++) name = `${base}${n}`
      used.add(name)
      if (name !== base) {
        notes.add('field-collision', path, `Another key in this object is also named ${base} in Go, so this field is ${name}.`)
      }

      const optional = isOptional(decl.object, key)
      const t = expr(field.shape, path)
      const pointer = o.pointers && (optional || field.shape.null) && !t.nilable ? '*' : ''

      let tag: string
      if (isValidTagName(key)) {
        tag = `\`json:"${key}${optional ? ',omitempty' : ''}"\``
      } else {
        tag = '`json:"-"`'
        notes.add(
          'bad-go-tag',
          path,
          `The key ${JSON.stringify(key)} can't be written as a Go json tag, so ${name} is skipped (json:"-"). Decode it by hand.`,
        )
      }
      return [name, `${pointer}${t.type}`, tag] as const
    })

    const nameWidth = Math.max(...rows.map((r) => width(r[0])))
    const typeWidth = Math.max(...rows.map((r) => width(r[1])))
    const lines = rows.map(
      ([name, type, tag]) =>
        `\t${name}${' '.repeat(nameWidth - width(name) + 1)}${type}${' '.repeat(typeWidth - width(type) + 1)}${tag}`,
    )
    blocks.push(`type ${decl.name} struct {\n${lines.join('\n')}\n}`)
  }

  return `${blocks.join('\n\n')}\n`
}
