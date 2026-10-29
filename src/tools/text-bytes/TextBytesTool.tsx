import { useDeferredValue, useMemo } from 'react'
import { ArrowLeftRight, Download } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import { downloadBlob } from '@/lib/util/download'
import { headOf, INLINE_MAX_BYTES } from '@fadeltd/devtools-core/base64'
import {
  decodeText,
  encodeText,
  type ByteFormat,
  type Detection,
  type HexPrefix,
  type InputFormat,
  type Separator,
} from '@fadeltd/devtools-core/text-bytes'

type Direction = 'encode' | 'decode'
type Fallback = 'replacement' | 'latin1'

interface State {
  input: string
  direction: Direction
  /** Kept apart from decodeFormat so 'auto' never leaks into the encoder. */
  format: ByteFormat
  decodeFormat: InputFormat
  separator: Separator
  uppercase: boolean
  prefix: HexPrefix
  perLine: number
  fallback: Fallback
}

const INITIAL: State = {
  input: '',
  direction: 'encode',
  format: 'binary',
  decodeFormat: 'auto',
  separator: 'space',
  uppercase: false,
  prefix: 'none',
  perLine: 0,
  fallback: 'replacement',
}

const FORMAT_LABELS: Record<ByteFormat, string> = {
  binary: 'Binary',
  hex: 'Hex',
  decimal: 'Decimal',
  octal: 'Octal',
}

const DETECTION_REASONS: Record<Detection['reason'], string> = {
  prefix: 'by prefix',
  'only-valid': 'only match',
  cleanest: 'most text-like',
  precedence: 'tie-break',
  'none-valid': 'closest match',
}

interface Note {
  tone: 'neutral' | 'warn'
  text: string
}

interface Outcome {
  output: string
  /** Shown in the output pane in place of the output: the input cannot be read. */
  error: string | null
  /** Set when the output is a stand-in for text that does not exist. */
  fallback: { label: string; problem: string } | null
  stats: string | null
  notes: Note[]
  /** The format bytes were read as, for Swap. */
  format: ByteFormat | null
}

/**
 * How much output goes into the textarea once it passes INLINE_MAX_BYTES.
 * Binary is about 9 characters per input byte, so a few-MB paste would put
 * tens of MB in the DOM and freeze layout; Copy and Download still get it all.
 * 64K rather than base64's 2K head: this is text people read and scroll, and
 * a 2K slice of binary is barely four lines of a wide pane.
 */
const PREVIEW_CHARS = 64 * 1024

const plural = (n: number, one: string) => `${formatCount(n)} ${one}${n === 1 ? '' : 's'}`

/** Two short badges rather than one long one: badges do not wrap, and a phone is 390px wide. */
function detectionNotes(d: Detection): Note[] {
  const notes: Note[] = [{ tone: 'neutral', text: `Detected ${FORMAT_LABELS[d.format].toLowerCase()} · ${DETECTION_REASONS[d.reason]}` }]
  if (d.alsoValid.length > 0) {
    // The guess could be wrong, so say so where it can be seen: no tooltip on touch.
    const others = d.alsoValid.map((f) => FORMAT_LABELS[f].toLowerCase()).join(' / ')
    notes.push({ tone: 'warn', text: `also valid as ${others}` })
  }
  return notes
}

function compute(s: State): Outcome {
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
    const notes: Note[] = []
    if (r.loneSurrogates > 0) {
      notes.push({
        tone: 'warn',
        text: `${plural(r.loneSurrogates, 'lone surrogate')} encoded as U+FFFD`,
      })
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
  const notes: Note[] = r.detection !== null ? detectionNotes(r.detection) : []

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

export default function TextBytesTool() {
  useToolUsageTracker('text-bytes')
  const { state, setState, reset } = useToolState<State>('text-bytes', INITIAL)

  const deferred = useDeferredValue(state)
  const outcome = useMemo(() => compute(deferred), [deferred])
  const encoding = state.direction === 'encode'
  // Characters, not bytes: what the textarea pays for is string length, and
  // the encoded output is ASCII anyway.
  const capped = outcome.output.length > INLINE_MAX_BYTES
  const shown = useMemo(
    () => (capped ? headOf(outcome.output, PREVIEW_CHARS).head : outcome.output),
    [capped, outcome.output],
  )
  // Only offer the fallback choice when a fallback is on screen.
  const showFallback = !encoding && outcome.fallback !== null
  const set = <K extends keyof State>(key: K, value: State[K]) => setState((p) => ({ ...p, [key]: value }))

  function swap() {
    // Swapping feeds the output back in as input, which would put the whole
    // capped output in the input textarea: exactly what the cap prevents.
    if (capped) return
    setState((p) => {
      const usable = outcome.error === null && outcome.fallback === null && outcome.output !== ''
      if (p.direction === 'encode') {
        // Decode with the format just written, not 'auto': the output of
        // "65 66" is ambiguous, but we know exactly what it is.
        return { ...p, direction: 'decode', decodeFormat: p.format, input: usable ? outcome.output : p.input }
      }
      return {
        ...p,
        direction: 'encode',
        format: outcome.format ?? p.format,
        input: usable ? outcome.output : p.input,
      }
    })
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'Text to Binary / Hex',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(outcome.output),
    },
    {
      combo: 'mod+shift+s',
      label: 'Swap direction',
      group: 'Text to Binary / Hex',
      scope: 'tool',
      whileTyping: true,
      run: swap,
    },
  ])

  const hex = state.format === 'hex'

  function download() {
    const name = outcome.format === null ? 'output' : FORMAT_LABELS[outcome.format].toLowerCase()
    downloadBlob(new Blob([outcome.output], { type: 'text/plain' }), encoding ? `bytes.${name}.txt` : 'text.txt')
  }

  return (
    <ToolFrame
      slug="text-bytes"
      actions={
        <>
          <Segmented
            value={state.direction}
            onChange={(direction) => set('direction', direction)}
            options={[
              { value: 'encode', label: 'Text → Bytes' },
              { value: 'decode', label: 'Bytes → Text' },
            ]}
          />

          {encoding ? (
            <>
              <Select value={state.format} onChange={(e) => set('format', e.target.value as ByteFormat)} title="Format">
                <option value="binary">Binary</option>
                <option value="hex">Hex</option>
                <option value="decimal">Decimal</option>
                <option value="octal">Octal</option>
              </Select>
              <Select
                value={state.separator}
                onChange={(e) => set('separator', e.target.value as Separator)}
                title="Separator"
              >
                <option value="space">Space</option>
                <option value="none">No separator</option>
                <option value="comma">Comma</option>
                <option value="newline">One per line</option>
              </Select>
              {hex && (
                <>
                  <Select value={state.prefix} onChange={(e) => set('prefix', e.target.value as HexPrefix)} title="Prefix">
                    <option value="none">No prefix</option>
                    <option value="0x">0x per byte</option>
                    <option value="\x">\x per byte</option>
                  </Select>
                  <Toggle checked={state.uppercase} onChange={(v) => set('uppercase', v)}>
                    Uppercase
                  </Toggle>
                </>
              )}
              {state.separator !== 'newline' && (
                <Select
                  value={String(state.perLine)}
                  onChange={(e) => set('perLine', Number(e.target.value))}
                  title="Bytes per line"
                >
                  <option value="0">One line</option>
                  <option value="8">8 per line</option>
                  <option value="16">16 per line</option>
                  <option value="32">32 per line</option>
                </Select>
              )}
            </>
          ) : (
            <>
              <Select
                value={state.decodeFormat}
                onChange={(e) => set('decodeFormat', e.target.value as InputFormat)}
                title="Input format"
              >
                <option value="auto">Auto-detect</option>
                <option value="binary">Binary</option>
                <option value="hex">Hex</option>
                <option value="decimal">Decimal</option>
                <option value="octal">Octal</option>
              </Select>
              {showFallback && (
                <Select
                  value={state.fallback}
                  onChange={(e) => set('fallback', e.target.value as Fallback)}
                  title="How to show bytes that are not UTF-8"
                >
                  <option value="replacement">Show bad bytes as �</option>
                  <option value="latin1">Show as Latin-1</option>
                </Select>
              )}
            </>
          )}

          <Button
            onClick={swap}
            disabled={capped}
            title={capped ? 'The output is too large to swap back in' : 'Swap direction (⌘⇧S)'}
          >
            <ArrowLeftRight size={14} aria-hidden />
            Swap
          </Button>
          <CopyButton value={outcome.output} />
          <Button onClick={download} disabled={outcome.output === ''} title="Download the whole output as a .txt">
            <Download size={14} aria-hidden />
            Download
          </Button>
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel={encoding ? 'Text' : 'Bytes'}
        rightLabel={encoding ? 'Bytes' : 'Text'}
        left={
          <CodeArea
            value={state.input}
            onChange={(e) => set('input', e.target.value)}
            placeholder={
              encoding
                ? 'Type or paste text. It is encoded as UTF-8…'
                : 'Paste bytes: 48 65 6c 6c 6f, \\x48\\x65, 0x48, 01001000 or 72 101…'
            }
          />
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            {outcome.fallback !== null && (
              <div className="flex shrink-0 flex-col items-start gap-1 border-b border-border px-3 py-1.5">
                <span className="font-mono text-[11px] text-del">{outcome.fallback.problem}</span>
                <Badge tone="warn">{outcome.fallback.label}</Badge>
              </div>
            )}
            {outcome.error !== null ? (
              <div className="flex-1 overflow-auto p-3 font-mono text-[13px] text-del scroll-thin">{outcome.error}</div>
            ) : (
              <CodeArea value={shown} readOnly placeholder="Output appears here" />
            )}
            {capped && (
              <p className="shrink-0 border-t border-border px-3 py-1.5 text-[12px] text-warn">
                Showing the first {formatCount(shown.length)} of {formatCount(outcome.output.length)} characters. Copy
                and Download include all of it.
              </p>
            )}
            {(outcome.stats !== null || outcome.notes.length > 0) && (
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
                {outcome.stats !== null && <span>{outcome.stats}</span>}
                {outcome.notes.map((note) => (
                  <Badge key={note.text} tone={note.tone}>
                    {note.text}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
