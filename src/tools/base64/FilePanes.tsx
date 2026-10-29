import type { Remote } from 'comlink'
import { Download, X } from 'lucide-react'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { formatBytes } from '@/lib/util/bytes'
import { downloadBlob } from '@/lib/util/download'
import { useWorkerJob } from '@/lib/worker/useWorkerJob'
import { base64Length, type Alphabet, type EncodeOptions } from './core/codec'
import { formatOutput, type Dimensions, type OutputForm } from './core/snippets'
import { fileTier, headOf } from './core/tiers'
import type { FileApi, Inspected } from './file.worker'

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
                ? 'size unavailable in this browser'
                : `${Math.round(size.width)} × ${Math.round(size.height)} px`}
          </span>
        )}
        {mismatch !== null && <Badge tone="warn">{mismatch}</Badge>}
        <span className="flex-1" />
        {children}
      </div>
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
            <Segmented value={form} options={FORMS} onChange={onForm} />
            {standardOnly && (
              <Badge title="data: URIs, <img> and CSS need standard, padded, unwrapped base64">
                standard alphabet
              </Badge>
            )}
          </div>
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
