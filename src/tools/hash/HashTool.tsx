import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented, type SegmentOption } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatBytes, formatCount } from '@/lib/util/bytes'
import { cn } from '@/lib/util/cn'
import {
  ALGORITHMS,
  DIGEST_LENGTH,
  digestAll,
  formatDigest,
  inspectInput,
  matchDigest,
  stripTrailingNewline,
  toBytes,
  type Algorithm,
} from '@fadeltd/devtools-core/hash'

type Format = 'hex' | 'HEX' | 'base64'

interface State {
  text: string
  format: Format
  compare: string
  stripNewline: boolean
}

const INITIAL: State = { text: '', format: 'hex', compare: '', stripNewline: false }

const FORMATS: readonly SegmentOption<Format>[] = [
  { value: 'hex', label: 'hex', title: 'Lowercase hex, as shasum prints it' },
  { value: 'HEX', label: 'HEX', title: 'Uppercase hex' },
  { value: 'base64', label: 'base64', title: 'Base64, as used by Subresource Integrity' },
]

interface Computed {
  /** The exact bytes these digests are of: the stale-result guard compares identity. */
  source: Uint8Array
  digests?: Record<Algorithm, Uint8Array>
  error?: string
}

export default function HashTool() {
  useToolUsageTracker('hash')
  const { state, setState, reset } = useToolState<State>('hash', INITIAL)

  const text = useDeferredValue(state.text)
  const { bytes, notes } = useMemo(() => {
    const hashed = state.stripNewline ? stripTrailingNewline(text) : text
    return { bytes: toBytes(hashed), notes: inspectInput(text) }
  }, [text, state.stripNewline])

  const [computed, setComputed] = useState<Computed | null>(null)
  useEffect(() => {
    // Digests resolve out of order when typing fast; a superseded input's
    // result must never overwrite a newer one.
    let cancelled = false
    digestAll(bytes).then(
      (digests) => {
        if (!cancelled) setComputed({ source: bytes, digests })
      },
      () => {
        if (!cancelled) {
          setComputed({
            source: bytes,
            error: 'This browser only hashes on a secure page (https or localhost).',
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [bytes])

  const pending = computed?.source !== bytes
  const digests = computed?.digests

  const match = useMemo(
    () => (state.compare.trim() === '' || !digests ? null : matchDigest(state.compare, digests)),
    [state.compare, digests],
  )

  const value = (a: Algorithm) => (digests ? formatDigest(digests[a], state.format) : '')

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy SHA-256',
      group: 'Hash Text',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(value('SHA-256')),
    },
  ])

  const trailing = notes.trailingNewlines
  const set = <K extends keyof State>(key: K, v: State[K]) => setState((p) => ({ ...p, [key]: v }))

  return (
    <ToolFrame
      slug="hash"
      actions={
        <>
          <Segmented value={state.format} options={FORMATS} onChange={(v) => set('format', v)} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel="Text"
        rightLabel="Digests"
        left={
          <div className="flex min-h-0 w-full flex-col">
            <CodeArea
              value={state.text}
              onChange={(e) => set('text', e.target.value)}
              placeholder="Type or paste text to hash. It is hashed as UTF-8, exactly as typed."
            />
            <div className="flex shrink-0 flex-col gap-1.5 border-t border-border px-3 py-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[11px] text-faint">
                  {formatCount(bytes.length)} bytes hashed
                  {bytes.length >= 1024 && ` (${formatBytes(bytes.length)})`}
                </span>
                {trailing > 0 && (
                  <Toggle checked={state.stripNewline} onChange={(v) => set('stripNewline', v)}>
                    Ignore one trailing newline
                  </Toggle>
                )}
              </div>
              {trailing > 0 && !state.stripNewline && (
                <Note title={trailing === 1 ? 'Ends with a newline' : `Ends with ${trailing} newlines`}>
                  <code className="font-mono">echo</code> adds one and{' '}
                  <code className="font-mono">printf</code> does not, so the same text can hash two
                  ways. If a hash doesn’t match, try ignoring it.
                </Note>
              )}
              {notes.crlf > 0 && (
                <Note title={`CRLF line endings (${formatCount(notes.crlf)})`}>
                  Windows line breaks are two bytes, <code className="font-mono">\r\n</code>, and
                  hash differently from <code className="font-mono">\n</code>.
                </Note>
              )}
              {notes.loneSurrogates && (
                <Note title="Broken character">
                  The text has half of an emoji or other paired character. UTF-8 cannot encode it,
                  so it is hashed as U+FFFD.
                </Note>
              )}
            </div>
          </div>
        }
        right={
          <div className="flex min-h-0 w-full flex-col overflow-y-auto border-t border-border scroll-thin md:border-t-0 md:border-l">
            <div className="flex flex-col gap-1.5 border-b border-border p-3">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-muted">Compare with</span>
                <input
                  className="min-h-11 w-full rounded-[4px] border border-border bg-bg px-2 font-mono text-fg placeholder:text-faint md:min-h-7"
                  value={state.compare}
                  onChange={(e) => set('compare', e.target.value)}
                  placeholder="Paste an expected hash: hex, base64, sha256=…, sha256sum output"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                />
              </label>
              {match !== null && !pending && (
                <div className="flex items-center gap-2">
                  {match.status === 'match' ? (
                    <Badge tone="add">Matches {match.algorithm}</Badge>
                  ) : match.status === 'none' ? (
                    <>
                      <Badge tone="del">No match</Badge>
                      <span className="text-[12px] text-muted">
                        {trailing > 0 && !state.stripNewline
                          ? 'Try ignoring the trailing newline.'
                          : 'None of the four digests is this one.'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Badge tone="del">Not a hash</Badge>
                      <span className="min-w-0 truncate text-[12px] text-muted">{match.message}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {computed?.error !== undefined ? (
              <p className="p-3 font-mono text-[13px] text-del">{computed.error}</p>
            ) : (
              ALGORITHMS.map((a) => {
                const matched = match?.status === 'match' && match.algorithm === a && !pending
                return (
                  <div
                    key={a}
                    className={cn(
                      'flex flex-col gap-1 border-b border-border px-3 py-2',
                      matched && 'bg-add-bg',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium">{a}</span>
                      <span className="font-mono text-[11px] text-faint">
                        {DIGEST_LENGTH[a] * 8}-bit
                      </span>
                      {matched && <Badge tone="add">Match</Badge>}
                      <span className="ml-auto">
                        <CopyButton value={pending ? '' : value(a)} />
                      </span>
                    </div>
                    <code
                      className={cn(
                        'select-all break-all font-mono text-[13px] leading-[18px]',
                        matched ? 'text-add' : 'text-fg',
                        pending && 'text-faint',
                      )}
                    >
                      {value(a) || '…'}
                    </code>
                  </div>
                )
              })
            )}

            <p className="p-3 text-[11px] leading-snug text-faint">
              SHA-1 is broken for signatures and certificates; use it only to match an existing
              checksum.
            </p>
          </div>
        }
      />
    </ToolFrame>
  )
}

function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <p className="text-[12px] leading-snug text-muted">
      <Badge tone="warn" className="mr-1.5 align-[1px]">
        {title}
      </Badge>
      {children}
    </p>
  )
}
