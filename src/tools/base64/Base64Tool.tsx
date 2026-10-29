import { useDeferredValue, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ArrowLeftRight, FileUp } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { cn } from '@/lib/util/cn'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatBytes } from '@/lib/util/bytes'
import { readFileHead } from '@/lib/util/filedrop'
import {
  base64Length,
  decodeBytesAs,
  decodeText,
  encodeText,
  type Alphabet,
} from './core/codec'
import { hexDump } from './core/hex'
import { isImageMime, sniffMime } from './core/magic'
import { firstInvalidIndex, sanitizeBase64Input } from './core/sanitize'
import { effectiveMime, mimeMismatch, type OutputForm } from './core/snippets'
import { FILE_MAX_BYTES, fileTier } from './core/tiers'
import { DecodedImage, FileEncoder, type StoredFile } from './FilePanes'

type Direction = 'encode' | 'decode'

interface State {
  text: string
  direction: Direction
  alphabet: Alphabet
  padding: boolean
  wrap: number
  lenient: boolean
  fallbackEncoding: string
  /** A dropped, picked or pasted file. Kept as a Blob: IndexedDB stores it as-is. */
  file: StoredFile | null
  outputForm: OutputForm
}

const INITIAL: State = {
  text: '',
  direction: 'encode',
  alphabet: 'base64',
  padding: true,
  wrap: 0,
  lenient: true,
  fallbackEncoding: 'latin1',
  file: null,
  outputForm: 'data-uri',
}

interface Outcome {
  output: string
  chips: string[]
  error: string | null
  note: string | null
  sizeNote: string | null
  /** Decoded bytes that are an image: previewed instead of hex-dumped. */
  image: { bytes: Uint8Array; mime: string; ext: string } | null
}

function compute(s: State): Outcome {
  if (s.text === '') {
    return { output: '', chips: [], error: null, note: null, sizeNote: null, image: null }
  }

  if (s.direction === 'encode') {
    const raw = new TextEncoder().encode(s.text).length
    const encoded = base64Length(raw, s.padding)
    return {
      output: encodeText(s.text, {
        alphabet: s.alphabet,
        padding: s.padding,
        ...(s.wrap > 0 ? { wrapAt: s.wrap } : {}),
      }),
      chips: [],
      error: null,
      note: null,
      sizeNote: `${formatBytes(raw)} → ${formatBytes(encoded)} (+${Math.round((encoded / raw - 1) * 100)}%)`,
      image: null,
    }
  }

  // Decode: clean the input first, and report every change made.
  const clean = sanitizeBase64Input(s.text)
  const chips: string[] = []
  if (clean.hadBom) chips.push('removed BOM')
  if (clean.wasDataUri) chips.push(`stripped data: header${clean.mime ? ` (${clean.mime})` : ''}`)
  if (clean.wasPercentEncoded) chips.push('percent-decoded')
  if (clean.strippedWhitespace > 0) {
    chips.push(`removed ${clean.strippedWhitespace} whitespace chars`)
  }
  if (clean.wasUrlSafe) chips.push('converted from base64url')

  if (clean.plainDataUri) {
    return {
      output: clean.payload,
      chips,
      error: null,
      note: 'This data: URI is percent-encoded text, not base64 — shown decoded as-is.',
      sizeNote: null,
      image: null,
    }
  }

  const bad = firstInvalidIndex(clean.payload, s.alphabet === 'base64url' ? 'base64url' : 'auto')
  if (bad) {
    return {
      output: '',
      chips,
      error: `Invalid character “${bad.char}” at position ${bad.index + 1} (line ${bad.line}, column ${bad.column}).`,
      note: null,
      sizeNote: null,
      image: null,
    }
  }

  const result = decodeText(clean.payload, { alphabet: 'auto', lenient: s.lenient })

  if (result.ok) {
    return {
      output: result.text,
      chips,
      error: null,
      note: null,
      sizeNote: `${formatBytes(clean.payload.length)} → ${formatBytes(result.bytes.length)}`,
      image: null,
    }
  }

  if (result.reason === 'invalid-base64') {
    return { output: '', chips, error: result.message, note: null, sizeNote: null, image: null }
  }

  // Valid base64, but the bytes are not UTF-8 text. Show what it actually is
  // rather than a wall of replacement characters.
  const sniffed = sniffMime(result.bytes)
  if (isImageMime(sniffed.mime)) {
    return {
      output: '',
      chips,
      error: null,
      note: null,
      sizeNote: `${formatBytes(result.bytes.length)} ${sniffed.mime}`,
      image: { bytes: result.bytes, mime: sniffed.mime, ext: sniffed.ext },
    }
  }
  const asFallback = decodeBytesAs(result.bytes, s.fallbackEncoding)
  return {
    output: `${hexDump(result.bytes)}\n\n--- decoded as ${s.fallbackEncoding} ---\n${asFallback}`,
    chips,
    error: null,
    note:
      `These bytes are not valid UTF-8. Detected ${sniffed.mime}` +
      `${sniffed.confidence === 'text' ? ' (heuristic)' : ''} — showing a hex dump.`,
    sizeNote: `${formatBytes(result.bytes.length)} of binary`,
    image: null,
  }
}

export default function Base64Tool() {
  useToolUsageTracker('base64')
  const { state, setState, reset } = useToolState<State>('base64', INITIAL)
  const pickerRef = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const deferred = useDeferredValue(state)
  const outcome = useMemo(() => compute(deferred), [deferred])
  const fileMode = state.direction === 'encode' && state.file !== null

  /** Every way a file arrives -- drop, pick, paste -- ends here. */
  async function takeFile(file: File) {
    if (fileTier(file.size) === 'refuse') {
      // Refused before reading a byte: a 2 GB drop must not touch memory.
      setFileError(`“${file.name}” is ${formatBytes(file.size)}. The limit is ${formatBytes(FILE_MAX_BYTES, 0)}.`)
      return
    }
    setFileError(null)
    const sniffed = sniffMime(await readFileHead(file))
    setState((p) => ({
      ...p,
      direction: 'encode',
      file: {
        id: crypto.randomUUID(),
        blob: file,
        name: file.name || 'pasted',
        mime: effectiveMime(file.type, sniffed),
        mismatch: mimeMismatch(file.name, file.type, sniffed),
      },
    }))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void takeFile(file)
  }

  function onPaste(e: ClipboardEvent) {
    // A copied screenshot arrives as a file, not text.
    const file = e.clipboardData.files[0]
    if (!file || state.direction !== 'encode') return
    e.preventDefault()
    void takeFile(file)
  }

  function swap() {
    setState((p) => ({
      ...p,
      direction: p.direction === 'encode' ? 'decode' : 'encode',
      // Feed the output back in, which is what you always want after a swap.
      text: outcome.error === null && outcome.output !== '' ? outcome.output : p.text,
    }))
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'Base64',
      scope: 'tool',
      whileTyping: true,
      // In file mode the output lives in the file pane, which has its own Copy.
      run: () => void (fileMode ? undefined : copyText(outcome.output)),
    },
    {
      combo: 'mod+shift+s',
      label: 'Swap encode/decode',
      group: 'Base64',
      scope: 'tool',
      whileTyping: true,
      run: swap,
    },
  ])

  return (
    <ToolFrame
      slug="base64"
      actions={
        <>
          <Segmented
            value={state.direction}
            onChange={(direction) => setState((p) => ({ ...p, direction }))}
            options={[
              { value: 'encode', label: 'Encode' },
              { value: 'decode', label: 'Decode' },
            ]}
          />

          <Select
            value={state.alphabet}
            onChange={(e) => setState((p) => ({ ...p, alphabet: e.target.value as Alphabet }))}
            title="Alphabet"
          >
            <option value="base64">Standard (+/)</option>
            <option value="base64url">URL-safe (-_)</option>
          </Select>

          {state.direction === 'encode' ? (
            <>
              <Toggle
                checked={state.padding}
                onChange={(v) => setState((p) => ({ ...p, padding: v }))}
              >
                Padding (=)
              </Toggle>
              <Select
                value={String(state.wrap)}
                onChange={(e) => setState((p) => ({ ...p, wrap: Number(e.target.value) }))}
                title="Line wrapping"
              >
                <option value="0">No wrapping</option>
                <option value="64">Wrap at 64 (PEM)</option>
                <option value="76">Wrap at 76 (MIME)</option>
              </Select>
              {/* The touch path: there is no drag-and-drop on a phone. */}
              <Button onClick={() => pickerRef.current?.click()} title="Encode an image or any file">
                <FileUp size={14} aria-hidden />
                Choose file
              </Button>
            </>
          ) : (
            <Toggle
              checked={state.lenient}
              onChange={(v) => setState((p) => ({ ...p, lenient: v }))}
            >
              Accept unpadded
            </Toggle>
          )}

          {!fileMode && (
            <>
              <Button onClick={swap} title="Swap direction (⌘⇧S)">
                <ArrowLeftRight size={14} aria-hidden />
                Swap
              </Button>
              <CopyButton value={outcome.output} />
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setFileError(null)
              reset()
            }}
          >
            Clear
          </Button>
          <input
            ref={pickerRef}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Reset so picking the same file again still fires onChange.
              e.target.value = ''
              if (file) void takeFile(file)
            }}
          />
        </>
      }
    >
      <div
        className={cn('flex h-full min-h-0 flex-col', dragging && 'outline-2 -outline-offset-2 outline-accent outline-dashed')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={onDrop}
      >
        {fileMode && state.file !== null ? (
          <>
            {/* A refused drop keeps the current file, so say why nothing changed. */}
            {fileError !== null && (
              <div className="flex shrink-0 border-b border-border px-3 py-1.5">
                <Badge tone="del">{fileError}</Badge>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <FileEncoder
                key={state.file.id}
                file={state.file}
                alphabet={state.alphabet}
                padding={state.padding}
                wrap={state.wrap}
                form={state.outputForm}
                onForm={(outputForm) => setState((p) => ({ ...p, outputForm }))}
                onRemove={() => {
                  setFileError(null)
                  setState((p) => ({ ...p, file: null }))
                }}
              />
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1">
            <TwoPane
              left={
                <div className="flex min-h-0 w-full flex-col">
                  <CodeArea
                    value={state.text}
                    onChange={(e) => setState((p) => ({ ...p, text: e.target.value }))}
                    onPaste={onPaste}
                    placeholder={
                      state.direction === 'encode'
                        ? 'Paste text to encode — or drop, paste or choose an image or file…'
                        : 'Paste base64, a data: URI, or PEM-wrapped output…'
                    }
                  />
                  {(outcome.chips.length > 0 || fileError !== null) && (
                    <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-3 py-1.5">
                      {fileError !== null && <Badge tone="del">{fileError}</Badge>}
                      {outcome.chips.map((chip) => (
                        <Badge key={chip}>{chip}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              }
              right={
                <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
                  {outcome.error !== null ? (
                    <div className="flex-1 overflow-auto p-3 font-mono text-[13px] text-del scroll-thin">
                      {outcome.error}
                    </div>
                  ) : outcome.image !== null ? (
                    <DecodedImage bytes={outcome.image.bytes} mime={outcome.image.mime} ext={outcome.image.ext} />
                  ) : (
                    <CodeArea value={outcome.output} readOnly placeholder="Output appears here" />
                  )}
                  <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
                    {outcome.sizeNote !== null && <span>{outcome.sizeNote}</span>}
                    {outcome.note !== null && <Badge tone="warn">{outcome.note}</Badge>}
                  </div>
                </div>
              }
            />
          </div>
        )}
      </div>
    </ToolFrame>
  )
}
