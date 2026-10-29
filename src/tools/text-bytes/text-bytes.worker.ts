import { expose } from 'comlink'
import { decodeText, encodeText, type ByteFormat, type Detection } from '@fadeltd/devtools-core/text-bytes'
import { formatCount } from '@/lib/util/bytes'
import { FORMAT_LABELS, type Outcome, type TextBytesInput } from './shared'

const DETECTION_REASONS: Record<Detection['reason'], string> = {
  prefix: 'by prefix',
  'only-valid': 'only match',
  cleanest: 'most text-like',
  precedence: 'tie-break',
  'none-valid': 'closest match',
}

const plural = (n: number, one: string) => `${formatCount(n)} ${one}${n === 1 ? '' : 's'}`

/** Two short badges rather than one long one: badges do not wrap, and a phone is 390px wide. */
function detectionNotes(d: Detection): Outcome['notes'] {
  const notes: Outcome['notes'] = [
    { tone: 'neutral', text: `Detected ${FORMAT_LABELS[d.format].toLowerCase()} · ${DETECTION_REASONS[d.reason]}` },
  ]
  if (d.alsoValid.length > 0) {
    // The guess could be wrong, so say so where it can be seen: no tooltip on touch.
    const others = d.alsoValid.map((f: ByteFormat) => FORMAT_LABELS[f].toLowerCase()).join(' / ')
    notes.push({ tone: 'warn', text: `also valid as ${others}` })
  }
  return notes
}

function compute(s: TextBytesInput): Outcome {
  const empty: Outcome = { output: '', error: null, fallback: null, stats: null, notes: [], format: null }
  if (s.input === '') return empty

  if (s.direction === 'encode') {
    const r = encodeText(s.input, {
      format: s.format,
      separator: s.separator,
      uppercase: s.uppercase,
      prefix: s.prefix,
      perLine: s.perLine,
    })
    const notes: Outcome['notes'] = []
    if (r.loneSurrogates > 0) {
      notes.push({ tone: 'warn', text: `${plural(r.loneSurrogates, 'lone surrogate')} encoded as U+FFFD` })
    }
    return {
      ...empty,
      output: r.output,
      stats: `${plural(r.charCount, 'char')} → ${plural(r.byteCount, 'byte')}`,
      notes,
      format: s.format,
    }
  }

  const r = decodeText(s.input, s.decodeFormat)
  const notes = r.detection !== null ? detectionNotes(r.detection) : []

  if (r.ok) {
    if (r.bom) notes.push({ tone: 'neutral', text: 'starts with a BOM (kept)' })
    return {
      ...empty,
      output: r.text,
      stats: `${plural(r.bytes.length, 'byte')} → ${plural(r.charCount, 'char')}`,
      notes,
      format: r.format,
    }
  }

  if (r.reason === 'syntax') return { ...empty, error: r.error.message, notes, format: r.format }

  return {
    ...empty,
    output: s.fallback === 'latin1' ? r.latin1 : r.replacement,
    fallback: {
      label: s.fallback === 'latin1' ? 'Not the text: bytes as Latin-1' : 'Not the text: bad bytes as �',
      problem: r.invalid.message,
    },
    stats: plural(r.bytes.length, 'byte'),
    notes,
    format: r.format,
  }
}

/**
 * Off the main thread because a few-MB paste takes a few hundred ms to encode
 * (binary is ~9 output characters per byte), and useDeferredValue cannot
 * interrupt a single synchronous computation: every keystroke paid for it.
 */
const api = {
  run(input: TextBytesInput): Outcome {
    return compute(input)
  },
}

export type TextBytesApi = typeof api

expose(api)
