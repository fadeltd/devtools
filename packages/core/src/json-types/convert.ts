import { analyze, stripJsonc, type Flavor, type JsonIssue } from '../json/errors.ts'
import { ndjsonToArray } from '../json/format.ts'
import { losslessSupported, parseLossless } from '../json/rawjson.ts'
import { emitGo } from './go.ts'
import { buildModel } from './model.ts'
import { noteSink, type TypeNote } from './notes.ts'
import { inferShape, MAX_DEPTH } from './shape.ts'
import { emitTypeScript } from './typescript.ts'
import { emitZod } from './zod.ts'

export type Target = 'typescript' | 'zod' | 'go'

export interface JsonTypesOptions {
  target: Target
  /** Name of the root type. Kept as typed when it is a valid identifier. Default `Root`. */
  rootName?: string
  /** TypeScript: `interface` (default) or `type`. */
  declaration?: 'interface' | 'type'
  /** Zod: also export `z.infer` types. Default true. */
  inferTypes?: boolean
  /** Go: pointers for optional and nullable fields. Default true. */
  pointers?: boolean
}

export interface JsonTypesResult {
  /** Empty when there are errors or no input. */
  output: string
  /** Parse errors, positioned, from the JSON tool's analyser. */
  errors: JsonIssue[]
  notes: TypeNote[]
  /** How the input was read. NDJSON reads each line as one sample of the root. */
  flavor: Flavor
  /** Documents merged into the root: 1, or the NDJSON line count. */
  samples: number
  /** Named types in the output, root alias included. */
  types: number
}

function parse(text: string): unknown {
  return losslessSupported ? parseLossless(text) : (JSON.parse(text) as unknown)
}

/**
 * Read the input into samples. Strict JSON goes straight through the lossless
 * parser; only when that fails is the slower analyser run, for its positioned
 * errors and its JSONC and NDJSON readings.
 */
function readSamples(text: string): { samples: unknown[]; errors: JsonIssue[]; flavor: Flavor } {
  if (text.trim() === '') return { samples: [], errors: [], flavor: 'empty' }
  try {
    return { samples: [parse(text)], errors: [], flavor: 'json' }
  } catch {
    /* fall through to the analyser */
  }

  const analysis = analyze(text, { lenient: true })
  if (analysis.value !== undefined) {
    let value: unknown = analysis.value
    try {
      value = parse(stripJsonc(text))
    } catch {
      /* keep the analyser's value; only number literals are lost */
    }
    return { samples: [value], errors: [], flavor: analysis.flavor }
  }
  if (analysis.ndjson !== null) {
    try {
      return { samples: parse(ndjsonToArray(text)) as unknown[], errors: [], flavor: 'ndjson' }
    } catch {
      /* detectNdjson said yes but a line still fails; report the errors */
    }
  }
  return { samples: [], errors: analysis.issues, flavor: analysis.flavor }
}

/**
 * Generate TypeScript, Zod or Go types from sample JSON. Never throws: bad
 * input comes back as positioned `errors`, and anything the output had to
 * approximate comes back as `notes` with the path it applies to.
 */
export function jsonTypes(text: string, options: JsonTypesOptions): JsonTypesResult {
  const { samples, errors, flavor } = readSamples(text)
  if (samples.length === 0) {
    return { output: '', errors, notes: [], flavor, samples: 0, types: 0 }
  }

  const notes = noteSink()
  const { shape, truncatedAt } = inferShape(samples)
  if (truncatedAt !== null) {
    notes.add('depth', truncatedAt, `Nested deeper than ${MAX_DEPTH} levels; everything below is typed as unknown.`)
  }

  const casing = options.target === 'go' ? 'go' : 'pascal'
  const model = buildModel(shape, options.rootName ?? 'Root', casing)

  let output: string
  switch (options.target) {
    case 'typescript':
      output = emitTypeScript(model, { declaration: options.declaration ?? 'interface' }, notes)
      break
    case 'zod':
      output = emitZod(model, { inferTypes: options.inferTypes ?? true }, notes)
      break
    case 'go':
      output = emitGo(model, { pointers: options.pointers ?? true }, notes)
      break
  }

  return {
    output,
    errors: [],
    notes: notes.list(),
    flavor,
    samples: samples.length,
    types: model.decls.length + (model.alias === null ? 0 : 1),
  }
}
