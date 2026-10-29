import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Clock, Eye, EyeOff } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import {
  ALGORITHMS,
  PRESETS,
  PRESET_IDS,
  inspectInput,
  presetAlgorithm,
  signWebhook,
  toBytes,
  verifyWebhook,
  type Algorithm,
  type HeaderLine,
  type KeyEncoding,
  type PresetId,
  type SignResult,
  type Verification,
} from '@fadeltd/devtools-core/hash'

interface State {
  preset: PresetId
  algorithm: Algorithm
  key: string
  keyEncoding: KeyEncoding
  showKey: boolean
  timestamp: string
  body: string
  signature: string
}

// Never persisted: the registry declares store 'none', so useToolState is
// plain component state here and the key dies with the tab.
const INITIAL: State = {
  preset: 'github',
  algorithm: 'SHA-256',
  key: '',
  keyEncoding: 'text',
  showKey: false,
  timestamp: '',
  body: '',
  signature: '',
}

const KEY_ENCODINGS: Record<KeyEncoding, string> = {
  text: 'Text (UTF-8)',
  hex: 'Hex',
  base64: 'Base64',
}

const SIGNATURE_PLACEHOLDER: Record<PresetId, string> = {
  github: 'sha256=… or the whole X-Hub-Signature-256 line',
  stripe: 't=…,v1=… or the whole Stripe-Signature line',
  slack: 'v0=… or the whole X-Slack-Signature line',
  plain: 'Hex or base64 signature',
}

interface Output {
  sign: SignResult
  verification: Verification | null
}

const headerLine = (h: HeaderLine) => `${h.name}: ${h.value}`

const field =
  'min-h-11 w-full min-w-0 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg placeholder:text-faint md:min-h-7'

export default function HmacTool() {
  useToolUsageTracker('hmac')
  const { state, setState, reset } = useToolState<State>('hmac', INITIAL)
  const set = <K extends keyof State>(key: K, v: State[K]) => setState((p) => ({ ...p, [key]: v }))

  const preset = PRESETS[state.preset]
  const algorithm = presetAlgorithm(state.preset, state.algorithm)

  const input = useDeferredValue(state)
  const [output, setOutput] = useState<Output | null>(null)
  useEffect(() => {
    // A slow HMAC over a big body can resolve after a newer keystroke's; the
    // flag drops results for inputs that have since changed.
    let cancelled = false
    const base = {
      preset: input.preset,
      algorithm: input.algorithm,
      key: input.key,
      keyEncoding: input.keyEncoding,
      body: input.body,
      timestamp: input.timestamp,
    }
    const check =
      input.signature.trim() === ''
        ? Promise.resolve(null)
        : verifyWebhook({ ...base, signature: input.signature, now: Date.now() })
    void Promise.all([signWebhook(base), check]).then(([sign, verification]) => {
      if (!cancelled) setOutput({ sign, verification })
    })
    return () => {
      cancelled = true
    }
  }, [input])

  const notes = useMemo(() => inspectInput(input.body), [input.body])
  const byteLength = useMemo(() => toBytes(input.body).length, [input.body])

  const sign = output?.sign
  // The signature header is the last line (Slack's timestamp header comes first).
  const lastHeader = sign?.ok ? sign.headers.at(-1) : undefined
  const primary = !sign?.ok ? '' : lastHeader ? headerLine(lastHeader) : sign.hex

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: preset.header === null ? 'Copy signature' : 'Copy header',
      group: 'HMAC Signature',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(primary),
    },
  ])

  const tsDate = /^\d{1,11}$/.test(state.timestamp)
    ? new Date(Number(state.timestamp) * 1000).toISOString().replace('.000Z', 'Z')
    : null
  const keyError = sign && !sign.ok && sign.field === 'key' ? sign : null
  const verification = output?.verification ?? null
  const checkedWithHeaderT =
    verification !== null &&
    'timestamp' in verification &&
    verification.timestamp !== null &&
    verification.timestamp !== input.timestamp

  return (
    <ToolFrame
      slug="hmac"
      actions={
        <>
          <CopyButton value={primary} label={preset.header === null ? 'Copy signature' : 'Copy header'} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <div className="h-full overflow-y-auto scroll-thin md:flex md:overflow-hidden">
        {/* Inputs */}
        <div className="flex flex-col gap-3 border-b border-border p-3 md:w-85 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r md:scroll-thin">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Preset</span>
              <Select
                className="w-full"
                value={state.preset}
                onChange={(e) => set('preset', e.target.value as PresetId)}
              >
                {PRESET_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PRESETS[id].label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Algorithm</span>
              <Select
                className="w-full"
                value={algorithm}
                disabled={preset.algorithms.length === 1}
                title={
                  preset.algorithms.length === 1
                    ? `${preset.label} always signs with HMAC-${algorithm}`
                    : undefined
                }
                onChange={(e) => set('algorithm', e.target.value as Algorithm)}
              >
                {ALGORITHMS.map((a) => (
                  <option key={a} value={a}>
                    HMAC-{a}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="hmac-key" className="text-[12px] text-muted">
              Secret key
            </label>
            <div className="flex gap-1.5">
              <input
                id="hmac-key"
                className={field}
                type={state.showKey ? 'text' : 'password'}
                value={state.key}
                onChange={(e) => set('key', e.target.value)}
                placeholder={state.preset === 'stripe' ? 'whsec_…' : 'Signing secret'}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                // A password field invites password managers to save it;
                // these opt out of the common ones.
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                data-form-type="other"
                aria-invalid={keyError !== null}
              />
              <Button
                onClick={() => set('showKey', !state.showKey)}
                aria-pressed={state.showKey}
                aria-label={state.showKey ? 'Hide key' : 'Show key'}
                title={state.showKey ? 'Hide key' : 'Show key'}
              >
                {state.showKey ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">Key is</span>
              <Select
                value={state.keyEncoding}
                onChange={(e) => set('keyEncoding', e.target.value as KeyEncoding)}
              >
                {Object.entries(KEY_ENCODINGS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            {keyError !== null && <p className="text-[12px] text-del">{keyError.message}</p>}
            {state.key === '' && (
              <p className="text-[11px] leading-snug text-faint">
                {state.preset === 'stripe'
                  ? 'Use the whole whsec_… secret as text. Stripe signs with it as-is.'
                  : 'Most providers use the secret as plain text, not decoded.'}
              </p>
            )}
          </div>

          {preset.needsTimestamp && (
            <div className="flex flex-col gap-1">
              <label htmlFor="hmac-ts" className="text-[12px] text-muted">
                Timestamp (Unix seconds)
              </label>
              <div className="flex gap-1.5">
                <input
                  id="hmac-ts"
                  className={field}
                  inputMode="numeric"
                  value={state.timestamp}
                  onChange={(e) => set('timestamp', e.target.value)}
                  placeholder="1700000000"
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button
                  onClick={() => set('timestamp', String(Math.floor(Date.now() / 1000)))}
                  title="Use the current time"
                >
                  <Clock size={14} aria-hidden />
                  Now
                </Button>
              </div>
              {tsDate !== null && <span className="font-mono text-[11px] text-faint">{tsDate}</span>}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="hmac-sig" className="text-[12px] text-muted">
              Signature to check <span className="text-faint">(optional)</span>
            </label>
            <input
              id="hmac-sig"
              className={field}
              value={state.signature}
              onChange={(e) => set('signature', e.target.value)}
              placeholder={SIGNATURE_PLACEHOLDER[state.preset]}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
            />
            {verification !== null && <VerificationLine v={verification} />}
            {checkedWithHeaderT && verification !== null && 'timestamp' in verification && (
              <p className="text-[11px] leading-snug text-faint">
                Checked with t={verification.timestamp} from the pasted header, which is what Stripe
                signed.
              </p>
            )}
          </div>
        </div>

        {/* Body and output */}
        <div className="flex min-w-0 flex-col md:min-h-0 md:flex-1">
          <div className="flex shrink-0 items-center border-b border-border bg-surface px-3 py-1.5">
            <span className="text-[12px] text-muted">Payload (the raw request body)</span>
          </div>
          <CodeArea
            className="h-56 md:h-auto md:min-h-0 md:flex-1"
            value={state.body}
            onChange={(e) => set('body', e.target.value)}
            placeholder={'Paste the body exactly as received, byte for byte.\nRe-serialised JSON will not match: whitespace and key order are signed too.'}
          />
          <div className="flex shrink-0 flex-col gap-1.5 border-t border-border px-3 py-1.5">
            <span className="font-mono text-[11px] text-faint">{formatCount(byteLength)} bytes</span>
            {notes.trailingNewlines > 0 && (
              <Note title={notes.trailingNewlines === 1 ? 'Ends with a newline' : `Ends with ${notes.trailingNewlines} newlines`}>
                It is signed too. If the provider sent the body without it, this signature won’t
                match.
              </Note>
            )}
            {notes.crlf > 0 && (
              <Note title={`CRLF line endings (${formatCount(notes.crlf)})`}>
                Pasting through some editors turns <code className="font-mono">\n</code> into{' '}
                <code className="font-mono">\r\n</code>, which changes the signature.
              </Note>
            )}
          </div>

          <div className="shrink-0 border-t border-border md:max-h-[55%] md:overflow-y-auto md:scroll-thin">
            {sign && !sign.ok && sign.field === 'timestamp' && (
              <p className="px-3 py-2 text-[12px] text-warn">{sign.message}</p>
            )}
            {sign?.ok && (
              <>
                {sign.headers.map((h) => (
                  <OutputRow key={h.name} label={h.name} value={headerLine(h)} />
                ))}
                <OutputRow label={`HMAC-${sign.algorithm} (hex)`} value={sign.hex} />
                <OutputRow label={`HMAC-${sign.algorithm} (base64)`} value={sign.base64} />
                <div className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-muted">Signed payload</span>
                    {sign.signedPayload !== state.body && (
                      <span className="text-[11px] text-faint">the exact string HMAC’d</span>
                    )}
                    <span className="ml-auto">
                      <CopyButton value={sign.signedPayload} />
                    </span>
                  </div>
                  <CodeArea
                    className="h-20 rounded-[4px] border border-border"
                    value={sign.signedPayload}
                    readOnly
                    placeholder="(empty)"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </ToolFrame>
  )
}

function OutputRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted">{label}</span>
        <span className="ml-auto">
          <CopyButton value={value} />
        </span>
      </div>
      <code className="select-all break-all font-mono text-[13px] leading-4.5 text-fg">{value}</code>
    </div>
  )
}

function VerificationLine({ v }: { v: Verification }) {
  switch (v.status) {
    case 'match':
      return (
        <div className="flex items-center gap-2">
          <Badge tone="add">Signature matches</Badge>
        </div>
      )
    case 'mismatch':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="del">No match</Badge>
          <span className="text-[12px] text-muted">
            {v.checked > 1 ? `None of ${v.checked} signatures matched.` : 'Check the key and the exact body.'}
          </span>
        </div>
      )
    case 'stale': {
      const age = Math.abs(v.ageSeconds)
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warn">Timestamp outside tolerance</Badge>
          <span className="text-[12px] text-muted">
            {formatCount(age)} s {v.ageSeconds >= 0 ? 'old' : 'in the future'}, window ±
            {v.toleranceSeconds} s. The signature {v.signatureMatches ? 'matches' : 'does not match either'}.
          </span>
        </div>
      )
    }
    case 'invalid':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="del">Can’t check</Badge>
          <span className="text-[12px] text-muted">{v.message}</span>
        </div>
      )
  }
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
