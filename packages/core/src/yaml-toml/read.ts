import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseAllDocuments,
  visit,
  type Document,
  type Node as YamlNode,
} from 'yaml'
import { parse as parseToml, TomlError } from 'smol-toml'
import { findNodeAtLocation, parseTree, type Node as JsonNode } from 'jsonc-parser'
import { analyze, stripJsonc } from '../json/errors.ts'
import { findNumberIssues } from '../json/format.ts'
import { losslessSupported } from '../json/rawjson.ts'
import type { PathSegment } from '../json/paths.ts'
import { fromJsonIssue, message, type Message, type SourceText } from './messages.ts'

export type Format = 'json' | 'yaml' | 'toml'

/**
 * A parsed input, before it is written in the target format.
 *
 * Values are plain data: null, boolean, number, string, arrays and objects,
 * plus three extensions -- `bigint` for integers a double cannot print
 * exactly, `Date` for TOML dates (and YAML 1.1 timestamps), and, for YAML and
 * TOML input, `bigint` for EVERY integer, so that `1` and `1.0` stay an
 * integer and a float on their way to TOML.
 */
export interface Reading {
  format: Format
  /** One per document. Only YAML can hold more than one. */
  values: unknown[]
  /** Set for YAML, so YAML → YAML can re-render the documents with their comments. */
  yamlDocs: Document[] | null
  /** True when the parser gave every integer as a bigint (YAML, TOML). */
  intsAreBigInt: boolean
  errors: Message[]
  warnings: Message[]
  notes: Message[]
  /** Offset of the value at `path` in document `doc`, to point a later error at it. */
  locate: (doc: number, path: readonly PathSegment[]) => number | null
}

const nowhere = () => null

function emptyReading(format: Format): Reading {
  return {
    format,
    values: [],
    yamlDocs: null,
    intsAreBigInt: false,
    errors: [],
    warnings: [],
    notes: [],
    locate: nowhere,
  }
}

// ---------------------------------------------------------------- JSON

const INTEGER = /^-?\d+$/

interface ReviverContext {
  source?: string
}

/**
 * Keep an integer literal exact when a double would print it differently --
 * whether it loses precision (12345678901234567890) or merely reprints
 * (2^60). Floats are left alone: JSON has no int/float distinction to keep.
 */
function exactIntegers(this: unknown, _key: string, value: unknown, context?: ReviverContext): unknown {
  const src = context?.source
  if (typeof value !== 'number' || src === undefined || !INTEGER.test(src)) return value
  return String(value) === src ? value : BigInt(src)
}

const exactReviver = exactIntegers as (key: string, value: unknown) => unknown

export function readJson(src: SourceText): Reading {
  const r = emptyReading('json')
  const text = src.text

  // The digit-run gate is ~free; only pay for the reviver when it trips.
  const numberIssues = findNumberIssues(text)
  const exact = numberIssues.length > 0 && losslessSupported

  let value: unknown
  let parsed = false
  try {
    value = exact ? JSON.parse(text, exactReviver) : JSON.parse(text)
    parsed = true
  } catch {
    // Accept JSONC (comments, trailing commas): config files are full of it,
    // and refusing them would only send the user to strip them by hand.
    const a = analyze(text, { lenient: true, tabWidth: src.tabWidth })
    if (a.value !== undefined) {
      const strict = stripJsonc(text)
      value = exact ? JSON.parse(strict, exactReviver) : a.value
      parsed = true
      r.notes.push(
        message('jsonc', 'Read as JSONC: comments and trailing commas were dropped.'),
      )
    } else {
      r.errors.push(...a.issues.map((issue) => fromJsonIssue(issue, src)))
      if (a.ndjson !== null) {
        r.errors[0] = {
          ...r.errors[0]!,
          hint: `This looks like NDJSON (${a.ndjson.records} records, one per line). Wrap them in [ … ] with commas to convert them as one array.`,
        }
      }
    }
  }

  if (!parsed) return r
  r.values = [value]

  // Without the source-text reviver (Safari < 18.4) the digits are already
  // gone by the time we see them. Say so rather than print rounded numbers
  // silently.
  if (!losslessSupported) {
    const lost = numberIssues.filter((n) => n.kind === 'precision')
    if (lost.length > 0) {
      const first = lost[0]!
      r.warnings.push(
        message(
          'json-precision-lost',
          `${lost.length} integer${lost.length === 1 ? '' : 's'} lost precision while parsing: ${first.literal} became ${first.printed}. This browser cannot read JSON numbers exactly.`,
          { ...src.atOffset(first.offset) },
        ),
      )
    }
  }

  let tree: JsonNode | undefined | null = null
  r.locate = (_doc, path) => {
    if (tree === null) tree = parseTree(text) ?? undefined
    if (tree === undefined) return null
    const node = findNodeAtLocation(tree, [...path])
    if (node === undefined) return null
    // Point at the key, not the value: `"port": null` reads better with the
    // caret under "port".
    return node.parent?.type === 'property' ? node.parent.offset : node.offset
  }
  return r
}

// ---------------------------------------------------------------- TOML

/** smol-toml's message carries its own code block; we draw our own. */
function tomlMessage(e: TomlError): string {
  const head = e.message.split('\n\n')[0] ?? e.message
  const text = head.replace(/^Invalid TOML document:\s*/, '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const TOML_HINTS: Array<[RegExp, string]> = [
  [/redefine/i, 'Each key and table can be defined only once in TOML.'],
  [/invalid value|unexpected/i, 'Strings need quotes in TOML: key = "value".'],
]

export function readToml(src: SourceText): Reading {
  const r = emptyReading('toml')
  r.intsAreBigInt = true
  try {
    // Every integer as a bigint: keeps > 2^53 exact, and keeps `1` an integer
    // and `1.0` a float when writing TOML back out.
    r.values = [parseToml(src.text, { integersAsBigInt: true })]
  } catch (e) {
    if (e instanceof TomlError) {
      const text = tomlMessage(e)
      const hint = TOML_HINTS.find(([re]) => re.test(text))?.[1] ?? null
      r.errors.push(message('toml-parse', text, { hint, ...src.at(e.line, e.column) }))
    } else {
      r.errors.push(message('toml-parse', e instanceof Error ? e.message : String(e)))
    }
  }
  return r
}

// ---------------------------------------------------------------- YAML

const CORE_TAGS = new Set(
  ['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map((t) => `tag:yaml.org,2002:${t}`),
)

function shortTag(tag: string): string {
  return tag.startsWith('tag:yaml.org,2002:') ? `!!${tag.slice('tag:yaml.org,2002:'.length)}` : tag
}

// YAML 1.1 (PyYAML, Go yaml.v2, many older tools) reads these differently
// from YAML 1.2, which this converter follows.
const YAML11_BOOL = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF)$/
const YAML11_OCTAL = /^[-+]?0[0-7]+$/
const YAML11_SEXAGESIMAL = /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+(?:\.[0-9_]*)?$/

interface Gotcha {
  code: string
  found: Array<{ text: string; offset: number }>
}

const YAML_HINTS: Record<string, string> = {
  DUPLICATE_KEY:
    'YAML requires unique keys. Many parsers silently keep the last one, so the earlier value would be lost.',
  TAB_AS_INDENT: 'YAML indentation must use spaces, never tabs.',
  BAD_INDENT: 'Check that this line is indented consistently with its siblings.',
  MISSING_CHAR: 'A closing quote or bracket is probably missing.',
  BLOCK_AS_IMPLICIT_KEY: 'A value containing ": " needs quotes, e.g. key: "a: b".',
  MULTILINE_IMPLICIT_KEY: 'Check the indentation of this line and the one above it.',
}

/**
 * A node's range starts at its value, after the tag. The caret belongs under
 * the tag itself, which is the `!…` token just before it (possibly on the
 * line above, for a block collection).
 */
function tagOffset(text: string, valueStart: number): number {
  let i = valueStart - 1
  while (i >= 0 && /\s/.test(text[i]!)) i--
  const end = i
  while (i >= 0 && !/\s/.test(text[i]!)) i--
  return end >= 0 && text[i + 1] === '!' ? i + 1 : valueStart
}

/** Show at most this many places in an aggregated note. */
const NOTE_EXAMPLES = 3

export function readYaml(src: SourceText, target: Format): Reading {
  const r = emptyReading('yaml')
  r.intsAreBigInt = true

  const docs = parseAllDocuments(src.text, {
    // YAML 1.2 core schema unless a document says `%YAML 1.1` itself.
    version: '1.2',
    // Every integer as a bigint, for the same reasons as TOML.
    intAsBigInt: true,
    // `<<: *base` is not in the 1.2 core schema, but every CI and compose
    // file uses it; ignoring it would silently produce a `<<` key.
    merge: true,
    uniqueKeys: true,
    // We build our own positioned messages from `pos`.
    prettyErrors: false,
    // toJS would otherwise console.warn about stringified collection keys.
    logLevel: 'error',
  })

  const list: Document[] = Array.from(docs)
  r.yamlDocs = list
  if (list.length === 0) {
    r.notes.push(message('yaml-empty', 'No YAML documents: the input is empty or only comments.'))
    return r
  }

  let aliases = 0
  let merges = 0
  const tags: Array<{ tag: string; offset: number }> = []
  const gotchas: Record<string, Gotcha> = {
    bool: { code: 'yaml11-bool', found: [] },
    octal: { code: 'yaml11-octal', found: [] },
    sexagesimal: { code: 'yaml11-sexagesimal', found: [] },
  }

  for (const doc of list) {
    for (const e of doc.errors) {
      r.errors.push(
        message(`yaml-${e.code.toLowerCase()}`, e.message, {
          hint: YAML_HINTS[e.code] ?? null,
          ...src.atOffset(e.pos[0]),
        }),
      )
    }
    for (const w of doc.warnings) {
      // Unknown tags are reported below, with a decision per target.
      if (w.code === 'TAG_RESOLVE_FAILED') continue
      r.warnings.push(message(`yaml-${w.code.toLowerCase()}`, w.message, src.atOffset(w.pos[0])))
    }

    const core = doc.schema.name === 'core'
    if (doc.directives?.yaml.explicit === true && doc.directives.yaml.version === '1.1') {
      r.notes.push(
        message(
          'yaml-1.1-directive',
          'A document declares %YAML 1.1, so it is read with YAML 1.1 rules: no/yes/on/off are booleans there.',
        ),
      )
    }

    visit(doc, {
      Alias(_key, node) {
        aliases++
        // The parser accepts `*name` with no `&name` before it; the library
        // only throws later, from toJS or toString. Report it here, with its
        // position, like any other parse error.
        if (node.resolve(doc) === undefined) {
          r.errors.push(
            message('yaml-unresolved-alias', `Alias *${node.source} has no anchor &${node.source} before it.`, {
              hint: 'Define the anchor (&name) before any alias (*name) that refers to it.',
              ...src.atOffset(node.range?.[0] ?? 0),
            }),
          )
        }
      },
      Node(_key, node) {
        const tag = (node as YamlNode).tag
        if (tag !== undefined && !CORE_TAGS.has(tag)) {
          tags.push({ tag, offset: tagOffset(src.text, (node as YamlNode).range?.[0] ?? 0) })
        }
        if (!isScalar(node)) return
        if (typeof node.value === 'symbol') merges++ // the `<<` merge key
        if (!core || node.type !== 'PLAIN' || node.tag !== undefined) return
        const raw = (node as { source?: unknown }).source
        if (typeof raw !== 'string') return
        const offset = node.range?.[0] ?? 0
        if (typeof node.value === 'string') {
          if (YAML11_BOOL.test(raw)) gotchas.bool!.found.push({ text: raw, offset })
          else if (YAML11_SEXAGESIMAL.test(raw)) gotchas.sexagesimal!.found.push({ text: raw, offset })
        } else if (typeof node.value === 'bigint' && YAML11_OCTAL.test(raw)) {
          gotchas.octal!.found.push({ text: raw, offset })
        }
      },
    })
  }

  if (r.errors.length > 0) return r

  // Tags: YAML → YAML keeps them as written (CloudFormation's !Ref, say,
  // must survive a reformat). Anywhere else they would have to be executed or
  // dropped, and we do neither.
  for (const { tag, offset } of tags) {
    if (target === 'yaml') continue
    r.errors.push(
      message('yaml-tag', `The tag ${shortTag(tag)} has no equivalent outside YAML.`, {
        hint: 'Tags are never evaluated here. Remove the tag, or convert YAML → YAML to keep it.',
        ...src.atOffset(offset),
      }),
    )
  }
  if (tags.length > 0 && target === 'yaml') {
    r.notes.push(
      message(
        'yaml-tags-kept',
        `Kept ${tags.length} tag${tags.length === 1 ? '' : 's'} (e.g. ${shortTag(tags[0]!.tag)}) as written; they are not evaluated.`,
      ),
    )
  }
  if (r.errors.length > 0) return r

  if (target !== 'yaml') {
    for (const doc of list) {
      try {
        // maxAliasCount stops a "billion laughs" document from expanding
        // into gigabytes.
        r.values.push(doc.toJS({ maxAliasCount: 100 }))
      } catch (e) {
        r.errors.push(
          message(
            'yaml-aliases',
            // yaml throws a ReferenceError for several alias problems; only
            // this message is the resource-exhaustion guard.
            e instanceof ReferenceError && /alias count/i.test(e.message)
              ? 'Too many aliases: expanding them would explode the document, so it was not converted.'
              : `Could not convert: ${e instanceof Error ? e.message : String(e)}`,
          ),
        )
        return r
      }
    }
    if (aliases > 0) {
      r.notes.push(
        message(
          'yaml-aliases-resolved',
          `Resolved ${aliases} alias${aliases === 1 ? '' : 'es'}: each *ref is written out in full as a copy of its &anchor.`,
        ),
      )
    }
    if (merges > 0) {
      r.notes.push(
        message(
          'yaml-merge-resolved',
          `Applied ${merges} merge key${merges === 1 ? '' : 's'} (<<): the merged keys are written out in place.`,
        ),
      )
    }
  }

  pushGotchas(r, src, gotchas, target)

  r.locate = (doc, path) => locateYaml(list[doc], path)
  return r
}

function places(src: SourceText, found: Gotcha['found']): string {
  const shown = found.slice(0, NOTE_EXAMPLES).map((f) => `${f.text} (line ${src.lineCol(f.offset).line})`)
  const more = found.length > NOTE_EXAMPLES ? ` and ${found.length - NOTE_EXAMPLES} more` : ''
  return shown.join(', ') + more
}

function pushGotchas(r: Reading, src: SourceText, g: Record<string, Gotcha>, target: Format) {
  const bool = g.bool!.found
  if (bool.length > 0) {
    r.notes.push(
      message(
        'yaml11-bool',
        `${places(src, bool)} ${bool.length === 1 ? 'stays a string' : 'stay strings'} under YAML 1.2. YAML 1.1 parsers such as PyYAML read ${bool.length === 1 ? 'it as a boolean' : 'them as booleans'} (the "Norway problem").`,
        {
          hint:
            target === 'yaml'
              ? 'Quote them to be read the same way everywhere.'
              : 'Converted as strings.',
          ...src.atOffset(bool[0]!.offset),
        },
      ),
    )
  }
  const octal = g.octal!.found
  if (octal.length > 0) {
    r.notes.push(
      message(
        'yaml11-octal',
        `${places(src, octal)}: a leading zero is just a decimal in YAML 1.2, so 0755 is 755. YAML 1.1 parsers read it as octal (0755 = 493).`,
        {
          hint: `Write 0o755 for an octal number, or quote it for a string.${target === 'yaml' ? ' The leading zero is dropped in the output.' : ''}`,
          ...src.atOffset(octal[0]!.offset),
        },
      ),
    )
  }
  const sexa = g.sexagesimal!.found
  if (sexa.length > 0) {
    r.notes.push(
      message(
        'yaml11-sexagesimal',
        `${places(src, sexa)} ${sexa.length === 1 ? 'stays a string' : 'stay strings'} under YAML 1.2. YAML 1.1 parsers read ${sexa.length === 1 ? 'it as a base-60 number' : 'them as base-60 numbers'} (22:22 = 1342).`,
        { hint: 'Quote values like ports and times.', ...src.atOffset(sexa[0]!.offset) },
      ),
    )
  }
}

/**
 * Walk a parsed document along a data path and return the offset of the last
 * node reached -- the key itself where there is one.
 */
function locateYaml(doc: Document | undefined, path: readonly PathSegment[]): number | null {
  if (doc === undefined) return null
  let node: unknown = doc.contents
  let offset: number | null = (node as YamlNode | null)?.range?.[0] ?? null
  for (const seg of path) {
    if (isAlias(node)) node = node.resolve(doc)
    if (isMap(node)) {
      const pair = node.items.find(
        (p) => isPair(p) && isScalar(p.key) && String(p.key.value) === String(seg),
      )
      if (pair === undefined) return offset
      offset = (pair.key as YamlNode).range?.[0] ?? offset
      node = pair.value
    } else if (isSeq(node) && typeof seg === 'number') {
      node = node.items[seg]
      offset = (node as YamlNode | null)?.range?.[0] ?? offset
    } else {
      return offset
    }
  }
  return offset
}

// ---------------------------------------------------------------- detection

/**
 * The format the first meaningful line suggests. Only used to decide whose
 * errors to show when no parser accepts the input, and to stop YAML -- which
 * reads almost any text as a string -- from "accepting" broken TOML or JSON.
 */
export function guessFormat(text: string): Format {
  // Line by line without split(): only the first meaningful line matters, and
  // the input may be megabytes.
  let start = 0
  while (start <= text.length) {
    const nl = text.indexOf('\n', start)
    const end = nl === -1 ? text.length : nl
    const line = text.slice(start, end).trim()
    start = end + 1
    if (line === '' || line.startsWith('#')) continue
    if (/^\[\[?\s*[A-Za-z0-9_."' -]+\]\]?\s*(?:#.*)?$/.test(line)) return 'toml'
    if (/^[A-Za-z0-9_"'-][A-Za-z0-9_."' -]*=/.test(line)) return 'toml'
    if (line.startsWith('{') || line.startsWith('[') || line.startsWith('//')) return 'json'
    return 'yaml'
  }
  return 'yaml'
}

function isScalarRoot(doc: Document): boolean {
  return doc.contents === null || isScalar(doc.contents)
}

/**
 * Read with auto-detection: JSON, then TOML, then YAML -- strictest first,
 * because YAML accepts most JSON and a fair amount of TOML-shaped text too.
 */
export function readAuto(src: SourceText, target: Format): Reading {
  try {
    JSON.parse(src.text)
    return readJson(src)
  } catch {
    /* not strict JSON */
  }
  const toml = readToml(src)
  if (toml.errors.length === 0) return toml
  const guess = guessFormat(src.text)
  const yaml = readYaml(src, target)
  // YAML reads `a = ` or `{"a": 1 // x` as a plain string. That is never
  // what someone pasting a broken config meant, so show the errors for the
  // format the text looks like instead.
  const trivial = yaml.yamlDocs !== null && yaml.yamlDocs.every(isScalarRoot)
  if (yaml.errors.length === 0 && !(trivial && guess !== 'yaml')) return yaml
  if (guess === 'json') return readJson(src)
  if (guess === 'toml') return toml
  return yaml
}
