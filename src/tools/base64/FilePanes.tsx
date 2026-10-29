import type { Remote } from 'comlink'
import { Download, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { formatBytes } from '@/lib/util/bytes'
import { downloadBlob } from '@/lib/util/download'
import { useWorkerJob } from '@/lib/worker/useWorkerJob'
import {
  base64Length,
  decodeBytesAs,
  type Alphabet,
  type EncodeOptions,
  formatOutput,
  type Dimensions,
  type OutputForm,
  fileTier,
  headOf,
} from '@fadeltd/devtools-core/base64'
import type { FileApi, Inspected } from './file.worker'
import { HexView } from './HexView'
import { SvgInspect } from './SvgInspect'
import { useAsyncValue } from './useAsyncValue'

export interface StoredFile {
  /** Fresh per pick, so a new file remounts its panes instead of showing the old one's output. */
  id: string
  blob: Blob
  name: string
  /** From the magic bytes where possible, never from the name alone. */
  mime: string
  /** Set when the name or declared type disagrees with the bytes. */
  mismatch: string | null
}

interface InspectInput {
  blob: Blob
  mime: string
  encode: EncodeOptions | null
}

function spawnFileWorker() {
  return new Worker(new URL('./file.worker.ts', import.meta.url), { type: 'module' })
}

function inspectInWorker(api: Remote<FileApi>, input: InspectInput): Promise<Inspected> {
  return api.inspect(input.blob, input.mime, input.encode)
}

/**
 * An object URL for previewing a Blob -- never a data: URI built just to
 * display it. The previous URL is revoked when the blob changes; revoking in
 * an effect cleanup would kill the live URL under StrictMode's double mount.
 */
function useObjectUrl(blob: Blob): string {
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  const previous = useRef<string>(undefined)
  useEffect(() => {
    if (previous.current !== undefined && previous.current !== url) URL.revokeObjectURL(previous.current)
    previous.current = url
  }, [url])
  return url
}

function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

const FORMS: { value: OutputForm; label: string; title: string }[] = [
  { value: 'data-uri', label: 'data: URI', title: 'data:<type>;base64,…' },
  { value: 'img', label: '<img>', title: 'An <img> tag with the data URI, size and alt text' },
  { value: 'css', label: 'CSS url()', title: 'url("data:…") for a stylesheet' },
  { value: 'base64', label: 'Base64', title: 'Just the encoded bytes' },
]

type FileView = 'encoded' | 'hex'

const VIEWS: { value: FileView; label: string; title: string }[] = [
  { value: 'encoded', label: 'Encoded', title: 'The file as base64' },
  { value: 'hex', label: 'Hex', title: 'The raw bytes as a hex dump, with their SHA-256' },
]

async function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/** The file's own bytes, read once the Hex view is opened. */
function FileHex({ blob, mime, name }: { blob: Blob; mime: string; name: string }) {
  const bytes = useAsyncValue(blob, readBytes)
  if (bytes.status === 'pending') return <p className="p-3 font-mono text-[12px] text-faint">Reading…</p>
  if (bytes.status === 'error') return <p className="p-3 font-mono text-[12px] text-del">{bytes.error}</p>
  return <HexView bytes={bytes.value} type={mime} name={name} />
}

/** Preview plus what the bytes actually are. Pasted SVG only ever renders through <img>, which runs no script. */
function FileCard({
  blob,
  name,
  mime,
  size,
  mismatch,
  children,
}: {
  blob: Blob
  name: string
  mime: string
  /** undefined while measuring; null when this browser cannot decode the format. */
  size: Dimensions | null | undefined
  mismatch: string | null
  children: ReactNode
}) {
  const url = useObjectUrl(blob)
  const isImage = mime.startsWith('image/')
  const isSvg = mime === 'image/svg+xml'

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface p-3">
        {isImage ? (
          <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="font-mono text-[12px] text-muted">No preview for {mime}</span>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
        <span className="max-w-full truncate text-muted" title={name}>
          {name}
        </span>
        <span>{mime}</span>
        <span>{formatBytes(blob.size)}</span>
        {isImage && (
          <span>
            {size === undefined
              ? 'measuring…'
              : size === null
                ? isSvg
                  ? 'no intrinsic size'
                  : 'size unavailable in this browser'
                : `${Math.round(size.width)} × ${Math.round(size.height)} px`}
          </span>
        )}
        {mismatch !== null && <Badge tone="warn">{mismatch}</Badge>}
        <span className="flex-1" />
        {children}
      </div>
      {isSvg && <SvgInspect blob={blob} name={baseName(name)} />}
    </div>
  )
}

/** Encode mode with a file: the card on the left, the chosen output form on the right. */
export function FileEncoder({
  file,
  alphabet,
  padding,
  wrap,
  form,
  onForm,
  onRemove,
}: {
  file: StoredFile
  alphabet: Alphabet
  padding: boolean
  wrap: number
  form: OutputForm
  onForm: (form: OutputForm) => void
  onRemove: () => void
}) {
  const input = useMemo<InspectInput>(
    () => ({
      blob: file.blob,
      mime: file.mime,
      // The wrapped forms are only valid with the standard, padded, unwrapped alphabet.
      encode:
        form === 'base64'
          ? { alphabet, padding, ...(wrap > 0 ? { wrapAt: wrap } : {}) }
          : { alphabet: 'base64', padding: true },
    }),
    [file.blob, file.mime, form, alphabet, padding, wrap],
  )
  const job = useWorkerJob(spawnFileWorker, inspectInWorker, input)
  const base64 = job.result?.base64 ?? null
  const [view, setView] = useState<FileView>('encoded')

  const output = useMemo(
    () => (base64 === null ? '' : formatOutput(form, file.mime, base64, { alt: baseName(file.name), size: job.result?.size ?? null })),
    [base64, form, file.mime, file.name, job.result?.size],
  )

  // Above the inline tier the full text never enters the DOM; Copy and
  // Download still get all of it.
  const large = fileTier(file.blob.size) === 'large'
  const shown = useMemo(() => {
    if (!large) return output
    const { head, omitted } = headOf(output)
    return omitted === 0 ? head : `${head}\n\n… ${omitted.toLocaleString('en-US')} more characters. Use Copy or Download for the whole thing.`
  }, [large, output])

  const encodedBytes = base64Length(file.blob.size, true)
  const standardOnly = form !== 'base64' && (alphabet !== 'base64' || !padding || wrap > 0)

  return (
    <TwoPane
      left={
        <FileCard
          blob={file.blob}
          name={file.name}
          mime={file.mime}
          size={job.result ? job.result.size : undefined}
          mismatch={file.mismatch}
        >
          <Button variant="ghost" onClick={onRemove} title="Back to text">
            <X size={14} aria-hidden />
            Remove file
          </Button>
        </FileCard>
      }
      right={
        <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
            <Segmented value={view} options={VIEWS} onChange={setView} />
            {view === 'encoded' && <Segmented value={form} options={FORMS} onChange={onForm} />}
            {view === 'encoded' && standardOnly && (
              <Badge title="data: URIs, <img> and CSS need standard, padded, unwrapped base64">
                standard alphabet
              </Badge>
            )}
          </div>
          {view === 'hex' ? (
            <FileHex blob={file.blob} mime={file.mime} name={baseName(file.name)} />
          ) : (
            <>
              <CodeArea value={shown} readOnly placeholder={job.status === 'running' ? 'Encoding…' : ''} />
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
                <span>
                  {formatBytes(file.blob.size)} → {formatBytes(encodedBytes)}
                </span>
                {large && <Badge title="The full text is not shown, to keep the page responsive">showing the first 2 KB</Badge>}
                {job.status === 'slow' && (
                  <>
                    <Badge tone="warn">Still encoding after 2s</Badge>
                    <Button variant="danger" onClick={job.cancel}>
                      Cancel
                    </Button>
                  </>
                )}
                {job.status === 'cancelled' && <Badge tone="del">Cancelled</Badge>}
                {job.status === 'error' && <Badge tone="del">{job.error}</Badge>}
                <span className="flex-1" />
                <CopyButton value={output} />
                <Button
                  disabled={output === ''}
                  onClick={() => downloadBlob(new Blob([output], { type: 'text/plain' }), `${baseName(file.name)}.${form}.txt`)}
                >
                  <Download size={14} aria-hidden />
                  Download
                </Button>
              </div>
            </>
          )}
        </div>
      }
    />
  )
}

/** Decode mode, when the bytes are an image: show it rather than a hex dump. */
export function DecodedImage({ bytes, mime, ext }: { bytes: Uint8Array; mime: string; ext: string }) {
  const blob = useMemo(() => new Blob([bytes.slice()], { type: mime }), [bytes, mime])
  const input = useMemo<InspectInput>(() => ({ blob, mime, encode: null }), [blob, mime])
  const job = useWorkerJob(spawnFileWorker, inspectInWorker, input)
  const name = `decoded.${ext}`

  return (
    <FileCard blob={blob} name={name} mime={mime} size={job.result ? job.result.size : undefined} mismatch={null}>
      <Button onClick={() => downloadBlob(blob, name)}>
        <Download size={14} aria-hidden />
        Download
      </Button>
    </FileCard>
  )
}

/**
 * Decode mode, when the text is an SVG: the text stays the output, with the
 * picture and the strip report above it. Valid UTF-8 never reaches the image
 * path, so without this a decoded SVG would only ever show as markup.
 */
export function DecodedSvg({ bytes, text }: { bytes: Uint8Array; text: string }) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex h-1/2 min-h-0 shrink-0 border-b border-border">
        <DecodedImage bytes={bytes} mime="image/svg+xml" ext="svg" />
      </div>
      <CodeArea value={text} readOnly className="min-h-0 flex-1" />
    </div>
  )
}

type BinaryView = 'hex' | 'text'

/** Decode mode, when the bytes are neither UTF-8 nor an image: a hex view, with a legacy-encoding reading beside it. */
export function DecodedBinary({
  bytes,
  mime,
  ext,
  known,
  fallbackEncoding,
}: {
  bytes: Uint8Array
  mime: string
  ext: string
  /** False when the bytes matched no signature. */
  known: boolean
  fallbackEncoding: string
}) {
  const [view, setView] = useState<BinaryView>('hex')
  // Only decoded when asked for: a 10 MB paste should not build a 10 MB string nobody looks at.
  const asText = useMemo(
    () => (view === 'text' ? decodeBytesAs(bytes, fallbackEncoding) : ''),
    [view, bytes, fallbackEncoding],
  )
  const options = useMemo<{ value: BinaryView; label: string; title?: string }[]>(
    () => [
      { value: 'hex', label: 'Hex' },
      { value: 'text', label: `Text (${fallbackEncoding})`, title: `The bytes read as ${fallbackEncoding}` },
    ],
    [fallbackEncoding],
  )
  const name = `decoded.${ext}`
  const download = (
    <Button onClick={() => downloadBlob(new Blob([bytes.slice()], { type: mime }), name)} title="Download the decoded bytes">
      <Download size={14} aria-hidden />
      Bytes
    </Button>
  )

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
        <Segmented value={view} options={options} onChange={setView} />
        {view === 'text' && (
          <>
            <span className="flex-1" />
            <CopyButton value={asText} />
            {download}
          </>
        )}
      </div>
      {view === 'hex' ? (
        <HexView bytes={bytes} type={known ? mime : null} name="decoded" actions={download} />
      ) : (
        <CodeArea value={asText} readOnly />
      )}
    </div>
  )
}
