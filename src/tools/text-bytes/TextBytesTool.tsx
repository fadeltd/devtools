import type { Remote } from 'comlink'
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
import type { ByteFormat, HexPrefix, InputFormat, Separator } from '@fadeltd/devtools-core/text-bytes'
import { useWorkerJob } from '@/lib/worker/useWorkerJob'
import { FORMAT_LABELS, hasLongLine, NO_WRAP_LINE, type Fallback, type Outcome, type TextBytesInput } from './shared'
import type { TextBytesApi } from './text-bytes.worker'

type State = TextBytesInput

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

const EMPTY: Outcome = { output: '', error: null, fallback: null, stats: null, notes: [], format: null }

// Module-level so useWorkerJob sees stable references.
function spawnCodec() {
  return new Worker(new URL('./text-bytes.worker.ts', import.meta.url), { type: 'module' })
}

function runInWorker(api: Remote<TextBytesApi>, input: TextBytesInput): Promise<Outcome> {
  return api.run(input)
}

/**
 * How much output goes into the textarea once it passes INLINE_MAX_BYTES.
 * Binary is about 9 characters per input byte, so a few-MB paste would put
 * tens of MB in the DOM and freeze layout; Copy and Download still get it all.
 * 64K rather than base64's 2K head: this is text people read and scroll, and
 * a 2K slice of binary is barely four lines of a wide pane.
 */
const PREVIEW_CHARS = 64 * 1024

export default function TextBytesTool() {
  useToolUsageTracker('text-bytes')
  const { state, setState, reset } = useToolState<State>('text-bytes', INITIAL)

  // The worker runs against a deferred snapshot, so a keystroke never waits on
  // an encode; the last finished outcome stays on screen meanwhile.
  const deferred = useDeferredValue(state)
  const job = useWorkerJob(spawnCodec, runInWorker, deferred)
  const outcome = job.result ?? EMPTY
  // Swap must not feed back an output computed for older input.
  const current = job.status === 'done' && deferred === state
  const unsettled = job.status === 'slow' || job.status === 'cancelled' || job.status === 'error'
  // On the keystroke, not deferred: a paste must lay out unwrapped first time.
  const noWrap = useMemo(() => hasLongLine(state.input, NO_WRAP_LINE), [state.input])
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
      const usable = current && outcome.error === null && outcome.fallback === null && outcome.output !== ''
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
            wrap={noWrap ? 'off' : undefined}
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
            {(outcome.stats !== null || outcome.notes.length > 0 || unsettled) && (
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
                {outcome.stats !== null && <span>{outcome.stats}</span>}
                {outcome.notes.map((note) => (
                  <Badge key={note.text} tone={note.tone}>
                    {note.text}
                  </Badge>
                ))}
                {job.status === 'slow' && (
                  <>
                    <Badge tone="warn">Still {encoding ? 'encoding' : 'decoding'} after 2s</Badge>
                    <Button variant="danger" onClick={job.cancel}>
                      Cancel
                    </Button>
                  </>
                )}
                {job.status === 'cancelled' && (
                  <Badge tone="del" title="Edit the input or an option to run again">
                    Cancelled — showing the last finished result
                  </Badge>
                )}
                {job.status === 'error' && <Badge tone="del">{job.error}</Badge>}
              </div>
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
