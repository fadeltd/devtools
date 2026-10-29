import { useDeferredValue, useMemo, useState } from 'react'
import { Download, Eye, EyeOff } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
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
import { cn } from '@/lib/util/cn'
import {
  DEFAULT_BORDER,
  DEFAULT_PIXEL_SIZE,
  ECC_LEVELS,
  ECC_RECOVERY,
  buildSvg,
  buildText,
  buildUrl,
  buildWifi,
  checkColors,
  encodeQr,
  modulePath,
  normalizeHex,
  pixelScale,
  type Ecc,
  type PayloadResult,
  type WifiSecurity,
} from '@fadeltd/devtools-core/qr'
import { renderPng } from './png'

type Kind = 'text' | 'url' | 'wifi'

interface State {
  kind: Kind
  text: string
  url: string
  ssid: string
  /** Never written to storage: see `redact`. */
  password: string
  showPassword: boolean
  security: WifiSecurity
  hidden: boolean
  ecc: Ecc
  border: number
  pixelSize: number
  foreground: string
  background: string
}

const INITIAL: State = {
  kind: 'url',
  text: '',
  url: '',
  ssid: '',
  password: '',
  showPassword: false,
  security: 'WPA',
  hidden: false,
  ecc: 'M',
  border: DEFAULT_BORDER,
  pixelSize: DEFAULT_PIXEL_SIZE,
  foreground: '#000000',
  background: '#ffffff',
}

/**
 * The Wi-Fi password is a secret, so it is stripped before every write; the
 * rest of the form persists. `showPassword` goes too, so a reload always
 * starts with the field masked. Module-level so its identity is stable and
 * useToolState does not rebuild its writer every render.
 */
function redact(state: State): Partial<State> {
  const { password: _password, showPassword: _showPassword, ...kept } = state
  return kept
}

const BORDERS = [0, 1, 2, 3, 4, 6, 8] as const
const PIXEL_SIZES = [256, 512, 1024, 2048, 4096] as const

const SECURITY: Record<WifiSecurity, string> = {
  WPA: 'WPA / WPA2 / WPA3',
  WEP: 'WEP',
  nopass: 'None (open)',
}

const field =
  'min-h-11 w-full min-w-0 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg placeholder:text-faint md:min-h-7'

function buildPayload(s: State, password: string): PayloadResult {
  if (s.kind === 'text') return buildText(s.text)
  if (s.kind === 'url') {
    const r = buildUrl(s.url)
    if (!r.ok || !r.addedScheme) return r
    return { ...r, warnings: ['No scheme given, so https:// was added.', ...r.warnings] }
  }
  return buildWifi({ ssid: s.ssid, password, security: s.security, hidden: s.hidden })
}

function compute(s: State) {
  const payload = buildPayload(s, s.password)
  const colors = checkColors(s.foreground, s.background)
  const qr = payload.ok ? encodeQr(payload.payload, { ecc: s.ecc, border: s.border }) : null
  // What the readout shows. A masked password must not reappear there in
  // clear, so it is rebuilt with bullets of the same length.
  const masked =
    s.kind === 'wifi' && !s.showPassword && s.password !== '' && s.security !== 'nopass'
      ? buildPayload(s, '•'.repeat([...s.password].length))
      : payload
  return { payload, colors, qr, shown: masked.ok ? masked.payload : '' }
}

export default function QrTool() {
  useToolUsageTracker('qr')
  const { state, setState, reset } = useToolState<State>('qr', INITIAL, { redact })
  const set = <K extends keyof State>(key: K, v: State[K]) => setState((p) => ({ ...p, [key]: v }))
  const [exportError, setExportError] = useState<string | null>(null)

  const deferred = useDeferredValue(state)
  const { payload, colors, qr, shown } = useMemo(() => compute(deferred), [deferred])
  const code = qr?.ok === true ? qr : null
  const d = useMemo(() => (code === null ? '' : modulePath(code.matrix)), [code])
  const scale = code === null ? null : pixelScale(deferred.pixelSize, code.size)

  const fg = colors.ok ? colors.foreground : '#000000'
  const bg = colors.ok ? colors.background : '#ffffff'
  const canExport = code !== null && colors.ok
  const raw = payload.ok ? payload.payload : ''

  const warnings = [
    ...(payload.ok ? payload.warnings : []),
    ...(code?.warnings ?? []),
    ...(colors.ok ? colors.warnings : []),
  ]
  // An empty form is a prompt, not a failure: show it quietly.
  const blank =
    (state.kind === 'text' && state.text === '') ||
    (state.kind === 'url' && state.url.trim() === '') ||
    (state.kind === 'wifi' && state.ssid === '' && state.password === '')
  const error = !payload.ok ? payload.message : qr !== null && !qr.ok ? qr.message : null

  function downloadSvg() {
    if (code === null || !colors.ok) return
    const r = buildSvg(code.matrix, { foreground: fg, background: bg, pixelSize: deferred.pixelSize })
    if (!r.ok) {
      setExportError(r.message)
      return
    }
    setExportError(null)
    downloadBlob(new Blob([r.svg], { type: 'image/svg+xml' }), `qr-${deferred.kind}.svg`)
  }

  async function downloadPng() {
    if (code === null || scale === null || !colors.ok) return
    const blob = await renderPng(code.matrix, scale.scale, fg, bg)
    if (blob === null) {
      setExportError('This browser could not draw the PNG. Try the SVG download.')
      return
    }
    setExportError(null)
    downloadBlob(blob, `qr-${deferred.kind}.png`)
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy encoded text',
      group: 'QR Code',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(raw),
    },
  ])

  return (
    <ToolFrame
      slug="qr"
      actions={
        <>
          <Segmented
            value={state.kind}
            onChange={(kind) => set('kind', kind)}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'url', label: 'URL' },
              { value: 'wifi', label: 'Wi-Fi' },
            ]}
          />
          <CopyButton value={raw} label="Copy text" />
          <Button
            variant="ghost"
            onClick={() => {
              setExportError(null)
              reset()
            }}
          >
            Clear
          </Button>
        </>
      }
    >
      <div className="h-full overflow-y-auto scroll-thin md:flex md:overflow-hidden">
        {/* Inputs */}
        <div className="flex flex-col gap-3 border-b border-border p-3 md:w-85 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r md:scroll-thin">
          {state.kind === 'text' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="qr-text" className="text-[12px] text-muted">
                Text
              </label>
              <CodeArea
                id="qr-text"
                className="h-40 rounded-[4px] border border-border"
                value={state.text}
                onChange={(e) => set('text', e.target.value)}
                placeholder="Any text: a note, a code, a vCard…"
              />
            </div>
          )}

          {state.kind === 'url' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="qr-url" className="text-[12px] text-muted">
                URL
              </label>
              <input
                id="qr-url"
                className={field}
                type="url"
                inputMode="url"
                value={state.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://example.com"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                aria-invalid={!payload.ok && !blank}
              />
            </div>
          )}

          {state.kind === 'wifi' && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="qr-ssid" className="text-[12px] text-muted">
                  Network name (SSID)
                </label>
                <input
                  id="qr-ssid"
                  className={field}
                  value={state.ssid}
                  onChange={(e) => set('ssid', e.target.value)}
                  placeholder="Home"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                />
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-muted">Security</span>
                <Select
                  className="w-full"
                  value={state.security}
                  onChange={(e) => set('security', e.target.value as WifiSecurity)}
                >
                  {Object.entries(SECURITY).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              {state.security !== 'nopass' && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="qr-password" className="text-[12px] text-muted">
                    Password
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      id="qr-password"
                      className={field}
                      type={state.showPassword ? 'text' : 'password'}
                      value={state.password}
                      onChange={(e) => set('password', e.target.value)}
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
                    />
                    <Button
                      onClick={() => set('showPassword', !state.showPassword)}
                      aria-pressed={state.showPassword}
                      aria-label={state.showPassword ? 'Hide password' : 'Show password'}
                      title={state.showPassword ? 'Hide password' : 'Show password'}
                    >
                      {state.showPassword ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                    </Button>
                  </div>
                  <p className="text-[11px] leading-snug text-faint">
                    Not saved. The rest of the form is kept for next time; the password never is.
                  </p>
                </div>
              )}
              <Toggle checked={state.hidden} onChange={(v) => set('hidden', v)}>
                Hidden network
              </Toggle>
            </>
          )}

          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Error correction</span>
              <Select className="w-full" value={state.ecc} onChange={(e) => set('ecc', e.target.value as Ecc)}>
                {ECC_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level} · {ECC_RECOVERY[level]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Quiet zone</span>
              <Select className="w-full" value={String(state.border)} onChange={(e) => set('border', Number(e.target.value))}>
                {BORDERS.map((b) => (
                  <option key={b} value={b}>
                    {b} module{b === 1 ? '' : 's'}
                    {b === DEFAULT_BORDER ? ' (spec)' : ''}
                  </option>
                ))}
              </Select>
            </label>
            <ColorField
              id="qr-fg"
              label="Foreground"
              value={state.foreground}
              onChange={(v) => set('foreground', v)}
              invalid={!colors.ok && colors.field === 'foreground'}
            />
            <ColorField
              id="qr-bg"
              label="Background"
              value={state.background}
              onChange={(v) => set('background', v)}
              invalid={!colors.ok && colors.field === 'background'}
            />
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[12px] text-muted">Image size</span>
              <Select className="w-full" value={String(state.pixelSize)} onChange={(e) => set('pixelSize', Number(e.target.value))}>
                {PIXEL_SIZES.map((px) => (
                  <option key={px} value={px}>
                    Up to {px} px
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {!colors.ok && <p className="text-[12px] text-del">{colors.message}</p>}
        </div>

        {/* Preview and export */}
        <div className="flex min-w-0 flex-col gap-3 p-3 md:min-h-0 md:flex-1 md:overflow-y-auto md:scroll-thin">
          <div className="flex min-h-64 items-center justify-center border border-border bg-surface p-4 md:flex-1">
            {code !== null ? (
              <svg
                viewBox={`0 0 ${code.size} ${code.size}`}
                shapeRendering="crispEdges"
                className="aspect-square w-full max-w-90"
                role="img"
                aria-label={`QR code, version ${code.version}`}
              >
                <rect width={code.size} height={code.size} fill={bg} />
                <path d={d} fill={fg} />
              </svg>
            ) : (
              <p className={cn('max-w-90 text-center text-[12px]', blank ? 'text-faint' : 'text-del')}>
                {blank ? 'The QR code appears here as you type.' : error}
              </p>
            )}
          </div>

          {code !== null && scale !== null && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-faint">
              <span>Version {code.version}</span>
              <span>
                {code.modules}×{code.modules} modules
              </span>
              <span>
                {formatCount(code.bytes)} {code.bytes === 1 ? 'byte' : 'bytes'}
              </span>
              <span>{code.mode} mode</span>
              <span>ECC {code.ecc}</span>
              <span>
                {scale.pixels}×{scale.pixels} px
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Button variant="primary" disabled={!canExport} onClick={downloadSvg}>
              <Download size={14} aria-hidden />
              Download SVG
            </Button>
            <Button disabled={!canExport} onClick={() => void downloadPng()}>
              <Download size={14} aria-hidden />
              Download PNG
            </Button>
          </div>
          {exportError !== null && <p className="text-[12px] text-del">{exportError}</p>}

          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1">
              {warnings.map((w) => (
                <li key={w} className="text-[12px] leading-snug text-warn">
                  {w}
                </li>
              ))}
            </ul>
          )}

          {shown !== '' && (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Encoded text</span>
              <p className="whitespace-pre-wrap break-all rounded-[4px] border border-border bg-bg p-2 font-mono text-[12px] text-fg">
                {shown}
              </p>
            </div>
          )}
        </div>
      </div>
    </ToolFrame>
  )
}

/**
 * A native colour picker beside a hex field. The picker is the touch path;
 * the field is for pasting a brand colour. The picker only understands
 * `#rrggbb`, so it shows black while the field holds something invalid.
 */
function ColorField({
  id,
  label,
  value,
  onChange,
  invalid,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  invalid: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] text-muted">
        {label}
      </label>
      <div className="flex gap-1.5">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          className="size-11 shrink-0 cursor-pointer rounded-[4px] border border-border bg-bg p-0.5 md:size-7"
          value={normalizeHex(value) ?? '#000000'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          id={id}
          className={field}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          aria-invalid={invalid}
        />
      </div>
    </div>
  )
}
