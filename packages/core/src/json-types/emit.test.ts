import { describe, expect, it } from 'vitest'
import { jsonTypes, type JsonTypesOptions } from './convert.ts'

const API = JSON.stringify({
  id: 7,
  name: 'Ada',
  score: 9.5,
  tags: ['a'],
  address: { street: 'x', zip: null },
  orders: [
    { id: 1, total: 10, note: 'gift' },
    { id: 2, total: 12.5, note: null, coupon: 'X' },
  ],
})

function out(text: string, options: JsonTypesOptions): string {
  return jsonTypes(text, options).output
}

describe('typescript', () => {
  it('writes interfaces, optional and nullable kept apart', () => {
    expect(out(API, { target: 'typescript' })).toBe(`export interface Root {
  id: number;
  name: string;
  score: number;
  tags: string[];
  address: Address;
  orders: Order[];
}

export interface Address {
  street: string;
  zip: null;
}

export interface Order {
  id: number;
  total: number;
  note: string | null;
  coupon?: string;
}
`)
  })

  it('writes type aliases on request', () => {
    expect(out('{"a":1}', { target: 'typescript', declaration: 'type' })).toBe(
      'export type Root = {\n  a: number;\n};\n',
    )
  })

  it('quotes keys that are not identifiers', () => {
    expect(out('{"foo-bar":1,"":2,"1st":3,"__proto__":4,"$ok":5}', { target: 'typescript' })).toBe(
      `export interface Root {
  "foo-bar": number;
  "": number;
  "1st": number;
  __proto__: number;
  $ok: number;
}
`,
    )
  })

  it('parenthesises unions inside arrays, and aliases a list root', () => {
    expect(out('[{"v":[1,"a",null]},{"v":[]}]', { target: 'typescript', rootName: 'Row' })).toBe(
      `export type RowList = Row[];

export interface Row {
  v: (string | number | null)[];
}
`,
    )
  })

  it('aliases primitive and map roots', () => {
    expect(out('"x"', { target: 'typescript' })).toBe('export type Root = string;\n')
    expect(out('{}', { target: 'typescript' })).toBe('export type Root = Record<string, unknown>;\n')
    expect(out('[]', { target: 'typescript' })).toBe('export type Root = unknown[];\n')
  })
})

describe('zod', () => {
  it('declares children before parents', () => {
    expect(out(API, { target: 'zod' })).toBe(`import { z } from "zod";

export const addressSchema = z.object({
  street: z.string(),
  zip: z.null(),
});
export type Address = z.infer<typeof addressSchema>;

export const orderSchema = z.object({
  id: z.number().int(),
  total: z.number(),
  note: z.string().nullable(),
  coupon: z.string().optional(),
});
export type Order = z.infer<typeof orderSchema>;

export const rootSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  score: z.number(),
  tags: z.array(z.string()),
  address: addressSchema,
  orders: z.array(orderSchema),
});
export type Root = z.infer<typeof rootSchema>;
`)
  })

  it('omits the inferred types on request', () => {
    expect(out('{"a":true}', { target: 'zod', inferTypes: false })).toBe(
      'import { z } from "zod";\n\nexport const rootSchema = z.object({\n  a: z.boolean(),\n});\n',
    )
  })

  it('computes the __proto__ key so it is not a prototype', () => {
    expect(out('{"__proto__":"x","a-b":1}', { target: 'zod', inferTypes: false })).toContain(
      '  ["__proto__"]: z.string(),\n  "a-b": z.number().int(),\n',
    )
  })

  it('writes a list root after its element', () => {
    expect(out('[{"a":1}]', { target: 'zod', inferTypes: false })).toBe(
      'import { z } from "zod";\n\nexport const rootSchema = z.object({\n  a: z.number().int(),\n});\n\nexport const rootListSchema = z.array(rootSchema);\n',
    )
  })

  it('uses unions, records and nullable unions', () => {
    const z = out('{"u":[1,"a",null],"m":{},"n":[null]}', { target: 'zod', inferTypes: false })
    expect(z).toContain('u: z.array(z.union([z.string(), z.number().int()]).nullable()),')
    expect(z).toContain('m: z.record(z.string(), z.unknown()),')
    expect(z).toContain('n: z.array(z.null()),')
  })

  it('drops .int() for integers beyond 2^53', () => {
    const r = jsonTypes('{"id":12345678901234567890}', { target: 'zod', inferTypes: false })
    expect(r.output).toContain('id: z.number(),')
    expect(r.notes.map((n) => [n.code, n.path])).toEqual([['big-integer', '.id']])
  })
})

describe('go', () => {
  it('aligns like gofmt, with initialisms, pointers and omitempty', () => {
    expect(out(API, { target: 'go' })).toBe(`type Root struct {
\tID      int64    \`json:"id"\`
\tName    string   \`json:"name"\`
\tScore   float64  \`json:"score"\`
\tTags    []string \`json:"tags"\`
\tAddress Address  \`json:"address"\`
\tOrders  []Order  \`json:"orders"\`
}

type Address struct {
\tStreet string \`json:"street"\`
\tZip    any    \`json:"zip"\`
}

type Order struct {
\tID     int64   \`json:"id"\`
\tTotal  float64 \`json:"total"\`
\tNote   *string \`json:"note"\`
\tCoupon *string \`json:"coupon,omitempty"\`
}
`)
  })

  it('drops pointers on request', () => {
    expect(out('[{"a":1},{"a":null,"b":"x"}]', { target: 'go', pointers: false })).toBe(
      'type RootList []Root\n\ntype Root struct {\n\tA int64  `json:"a"`\n\tB string `json:"b,omitempty"`\n}\n',
    )
  })

  it('never points at a slice, map or any', () => {
    expect(out('[{"a":[1],"m":{"k":1},"x":1},{"a":null,"m":null,"x":"s"}]', { target: 'go' })).toContain(
      '\tA []int64 `json:"a"`\n\tM *M      `json:"m"`\n\tX any     `json:"x"`\n',
    )
    expect(out('[{"a":[1]},{}]', { target: 'go' })).toContain('\tA []int64 `json:"a,omitempty"`\n')
  })

  it('points at nullable array elements', () => {
    expect(out('{"a":[1,null]}', { target: 'go' })).toContain('\tA []*int64 `json:"a"`\n')
  })

  it('widens integers to uint64, and past it to float64 with a note', () => {
    const r = jsonTypes('{"a":9223372036854775808,"b":18446744073709551616}', { target: 'go' })
    expect(r.output).toContain('\tA uint64  `json:"a"`\n\tB float64 `json:"b"`\n')
    expect(r.notes.map((n) => n.code)).toEqual(['big-integer'])
  })

  it('numbers colliding field names, and skips keys a tag cannot hold', () => {
    const r = jsonTypes('{"user_id":1,"userId":2,"a,b":3,"":4}', { target: 'go' })
    expect(r.output).toBe(`type Root struct {
\tUserID  int64 \`json:"user_id"\`
\tUserID2 int64 \`json:"userId"\`
\tAB      int64 \`json:"-"\`
\tField   int64 \`json:"-"\`
}
`)
    expect(r.notes.map((n) => [n.code, n.path])).toEqual([
      ['field-collision', '.userId'],
      ['bad-go-tag', '."a,b"'],
      ['bad-go-tag', '.""'],
    ])
  })

  it('aligns by runes, not UTF-16 units', () => {
    expect(out('{"名前":"x","id":1}', { target: 'go' })).toBe(
      'type Root struct {\n\tThe名前 string `json:"名前"`\n\tID    int64  `json:"id"`\n}\n',
    )
  })

  it('writes defined types for non-struct roots', () => {
    expect(out('[1,2]', { target: 'go' })).toBe('type Root []int64\n')
    expect(out('{}', { target: 'go' })).toBe('type Root map[string]any\n')
    expect(out('[1,"a"]', { target: 'go' })).toBe('type Root []any\n')
  })
})
