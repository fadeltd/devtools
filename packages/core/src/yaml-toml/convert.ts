import { message, SourceText, type Message } from './messages.ts'
import { readAuto, readJson, readToml, readYaml, type Format, type Reading } from './read.ts'
import { prepareFor, stringifyJson, writeToml, writeYamlDocs, writeYamlValue, type Indent } from './write.ts'

export type SourceFormat = Format | 'auto'

export interface ConvertOptions {
  /** JSON: 2, 4, tabs or minified. YAML: 2 or 4 (anything else is 2). TOML has no indent. */
  indent: Indent
  /**
   * Which document of a multi-document YAML stream to convert, 0-based.
   * 'all' gives a JSON array (or every document, for YAML); TOML holds one
   * document, so it needs a pick.
   */
  document: 'all' | number
  /** For lining the caret up under tab-indented lines. */
  tabWidth: number
}

export interface ConvertResult {
  output: string
  /** The format the input was read as; null for empty input. */
  detected: Format | null
  /** Documents in the input: more than 1 only for a YAML stream. */
  documents: number
  errors: Message[]
  warnings: Message[]
  notes: Message[]
}

const DEFAULTS: ConvertOptions = { indent: 2, document: 'all', tabWidth: 2 }

function read(src: SourceText, from: SourceFormat, to: Format): Reading {
  switch (from) {
    case 'auto':
      return readAuto(src, to)
    case 'json':
      return readJson(src)
    case 'toml':
      return readToml(src)
    case 'yaml':
      return readYaml(src, to)
  }
}

/** Full-line comments only: `color: "#fff"` is not a comment. */
const HAS_COMMENT = /^[ \t]*#/m

const NAMES: Record<Format, string> = { json: 'JSON', yaml: 'YAML', toml: 'TOML' }

/**
 * Convert between JSON, YAML and TOML. Never throws: every problem, with its
 * line and column where it has one, comes back in `errors`, and anything the
 * user should know about the conversion in `warnings` and `notes`.
 */
export function convert(
  input: string,
  from: SourceFormat,
  to: Format,
  options: Partial<ConvertOptions> = {},
): ConvertResult {
  let r: ConvertResult
  try {
    r = run(input, from, to, options)
  } catch (e) {
    // The parsers' own errors are all caught where they arise; this is the
    // backstop that keeps the "never throws" promise if a library throws
    // somewhere unexpected (fast-check found one such path).
    r = emptyResult()
    r.errors.push(message('internal', `Could not convert: ${e instanceof Error ? e.message : String(e)}`))
  }
  // Every document of a stream reports the same note ("dates written as
  // strings"); once is enough.
  return { ...r, errors: unique(r.errors), warnings: unique(r.warnings), notes: unique(r.notes) }
}

function unique(list: Message[]): Message[] {
  const seen = new Set<string>()
  return list.filter((m) => {
    const key = `${m.code}:${m.line}:${m.column}:${m.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function emptyResult(): ConvertResult {
  return { output: '', detected: null, documents: 0, errors: [], warnings: [], notes: [] }
}

function run(
  input: string,
  from: SourceFormat,
  to: Format,
  options: Partial<ConvertOptions>,
): ConvertResult {
  const o: ConvertOptions = { ...DEFAULTS, ...options }
  // A BOM makes JSON.parse fail, and is invisible to the user anyway.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const result = emptyResult()
  if (text.trim() === '') return result

  const src = new SourceText(text, o.tabWidth)
  const reading = read(src, from, to)
  result.detected = reading.format
  result.documents = reading.yamlDocs?.length ?? reading.values.length
  result.errors.push(...reading.errors)
  result.warnings.push(...reading.warnings)
  result.notes.push(...reading.notes)
  if (result.errors.length > 0 || result.documents === 0) return result

  const count = result.documents
  const picked =
    count > 1 && typeof o.document === 'number' && o.document >= 0 && o.document < count
      ? [o.document]
      : Array.from({ length: count }, (_, i) => i)

  if (to === 'yaml' && reading.yamlDocs !== null) {
    result.output = writeYamlDocs(
      picked.map((i) => reading.yamlDocs![i]!),
      o.indent,
    )
    return result
  }

  if (to === 'toml' && picked.length > 1) {
    result.errors.push(
      message(
        'toml-multi-doc',
        `This YAML stream has ${count} documents, and a TOML file holds one.`,
        { hint: 'Pick the document to convert.' },
      ),
    )
    return result
  }

  const prepared = picked.map((i) => prepareFor(reading.values[i], to, i, reading, src))
  for (const p of prepared) {
    result.errors.push(...p.errors)
    result.warnings.push(...p.warnings)
    result.notes.push(...p.notes)
  }
  if (result.errors.length > 0) return result

  const value = picked.length === 1 ? prepared[0]!.value : prepared.map((p) => p.value)
  if (picked.length > 1) {
    result.notes.push(
      message(
        'multi-doc-array',
        `${count} YAML documents written as one ${NAMES[to]} array, in order.`,
        { hint: 'Pick a document to convert just that one.' },
      ),
    )
  }

  if (reading.format !== 'json' && HAS_COMMENT.test(text)) {
    result.notes.push(
      message('comments-dropped', `Comments are not carried over to ${NAMES[to]}. Only YAML → YAML keeps them.`),
    )
  }

  switch (to) {
    case 'json':
      result.output = stringifyJson(value, o.indent)
      break
    case 'yaml':
      result.output = writeYamlValue(value, { indent: o.indent, keepFloats: reading.intsAreBigInt })
      break
    case 'toml': {
      const r = writeToml(value, { keepFloats: reading.intsAreBigInt })
      if (r.ok) result.output = r.text
      else result.errors.push(r.error)
      break
    }
  }
  return result
}
