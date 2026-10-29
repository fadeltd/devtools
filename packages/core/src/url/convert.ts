import {
  countEscapes,
  decode,
  decodeOptionsFor,
  detectDoubleEncoding,
  encode,
  type DecodeIssue,
  type LoneSurrogate,
  type Variant,
} from './codec.ts'

export type Mode = 'encode' | 'decode'

export interface ConvertOptions {
  mode: Mode
  variant: Variant
  /** Decode only: leave bad sequences in place instead of failing. */
  lenient: boolean
}

export type WarningKind = 'already-encoded' | 'double-encoded' | 'skipped' | 'plus-kept'

export interface Warning {
  kind: WarningKind
  message: string
}

export interface ConvertResult {
  output: string
  /** Set when there is no output to show. */
  error: LoneSurrogate | DecodeIssue | null
  /** Output is still valid, but something about the input deserves a look. */
  warnings: Warning[]
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** One call for the whole tool: the output plus everything worth saying about it. */
export function convert(input: string, o: ConvertOptions): ConvertResult {
  if (input === '') return { output: '', error: null, warnings: [] }
  const warnings: Warning[] = []

  if (o.mode === 'encode') {
    const r = encode(input, o.variant)
    if (!r.ok) return { output: '', error: r.error, warnings }
    const escapes = countEscapes(input)
    if (escapes > 0) {
      warnings.push({
        kind: 'already-encoded',
        message:
          `The input already contains ${plural(escapes, 'percent-escape')}, so encoding it again ` +
          `turns %20 into %2520. If it is already encoded, switch to Decode.`,
      })
    }
    return { output: r.output, error: null, warnings }
  }

  const r = decode(input, decodeOptionsFor(o.variant, o.lenient))
  if (!r.ok) return { output: '', error: r.error, warnings }

  const double = detectDoubleEncoding(input)
  if (double !== null) {
    warnings.push({
      kind: 'double-encoded',
      message:
        `Looks double-encoded: “${double.sample}” decodes to “${double.decodesTo}”, which is still ` +
        `encoded${double.count > 1 ? ` (${double.count} such sequences)` : ''}. Swap to decode the output again.`,
    })
  }
  if (r.skipped > 0 && r.firstSkipped !== null) {
    warnings.push({
      kind: 'skipped',
      message: `Left ${plural(r.skipped, 'malformed sequence')} as-is. First: ${r.firstSkipped.message}`,
    })
  }
  if (o.variant !== 'form' && input.includes('+')) {
    warnings.push({
      kind: 'plus-kept',
      message: '“+” was kept as “+”. In a query string or form body it means a space; use the Form variant for that.',
    })
  }
  return { output: r.output, error: null, warnings }
}
