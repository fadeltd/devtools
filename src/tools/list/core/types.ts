/**
 * A parsed line document.
 *
 * The separation of `lines` from `trailingNewline` and `eol` is the whole point:
 * "a\nb\n" is two lines that happen to end with a newline, NOT three lines where
 * the third is empty. Treating it as three is the single most common bug in
 * every free list tool -- you sort and get a phantom blank line at the top.
 */
export interface LineDoc {
  lines: string[]
  eol: '\n' | '\r\n' | '\r' | 'mixed'
  trailingNewline: boolean
  bom: boolean
}

export type SortMode = 'codepoint' | 'locale' | 'natural' | 'length' | 'random'
export type BlankPolicy = 'keep' | 'first' | 'last' | 'drop'

export type CaseTarget =
  | 'upper'
  | 'lower'
  | 'capitalize'
  | 'title'
  | 'sentence'
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'kebab'
  | 'constant'
  | 'dot'
  | 'path'
  | 'train'

export type LineTest =
  | { t: 'regex'; source: string; flags: string }
  | { t: 'contains'; needle: string; ci: boolean }
  | { t: 'blank' }
  | { t: 'index'; ranges: string }
  | { t: 'duplicate' }

/**
 * The full operation set is declared up front even though only a subset has UI:
 * `runPipeline` and the tests are built against the whole union, so adding a
 * later operation is additive rather than a refactor.
 */
export type Op =
  | {
      kind: 'sort'
      order: 'asc' | 'desc'
      mode: SortMode
      caseSensitive: boolean
      locale?: string
      blanks: BlankPolicy
    }
  | {
      kind: 'dedupe'
      caseSensitive: boolean
      trimKey: boolean
      keep: 'first' | 'last'
      output: 'unique' | 'duplicates-only' | 'unique-only' | 'with-counts'
    }
  | { kind: 'shuffle'; source: 'crypto' | 'seeded'; seed?: number }
  | { kind: 'reverse' }
  | { kind: 'case'; target: CaseTarget; locale?: string }
  | { kind: 'affix'; prefix: string; suffix: string; skipBlank: boolean }
  | { kind: 'filter'; action: 'keep' | 'remove'; test: LineTest }
  | {
      kind: 'number'
      start: number
      step: number
      pad: number
      padChar: string
      separator: string
      position: 'prefix' | 'suffix'
      skipBlank: boolean
    }
  | { kind: 'wrap'; width: number; breakWords: boolean; preserveIndent: boolean }
  | { kind: 'join'; separator: string; chunkSize?: number }
  | { kind: 'split'; by: { t: 'literal'; s: string } | { t: 'regex'; source: string; flags: string } }
  | { kind: 'trim'; leading: boolean; trailing: boolean; collapseInternal: boolean }
  | { kind: 'normalize'; form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' }
  | {
      kind: 'setop'
      op: 'union' | 'intersection' | 'difference' | 'symmetric-difference'
      other: string
      caseSensitive: boolean
      bag: boolean
    }
  | { kind: 'slice'; from: number; to?: number }

export interface StepStat {
  op: Op
  inLines: number
  outLines: number
  ms: number
  warning?: string
  error?: string
}
