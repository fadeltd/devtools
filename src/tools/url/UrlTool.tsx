import { useDeferredValue, useMemo } from 'react'
import { ArrowLeftRight, ChevronDown, ChevronRight } from 'lucide-react'
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
import {
  buildQuery,
  convert,
  parseInput,
  type Mode,
  type ParsedInput,
  type QueryRow,
  type Variant,
} from '@fadeltd/devtools-core/url'

interface State {
  input: string
  mode: Mode
  variant: Variant
  lenient: boolean
  showParams: boolean
}

const INITIAL: State = {
  input: '',
  mode: 'encode',
  variant: 'component',
  lenient: false,
  showParams: true,
}

const VARIANT_LABELS: Record<Variant, { label: string; title: string }> = {
  component: { label: 'Component', title: 'encodeURIComponent: one value, every reserved character escaped' },
  uri: { label: 'Full URL', title: 'encodeURI: keeps : / ? # & = so the URL still works' },
  form: { label: 'Form (+ for space)', title: 'application/x-www-form-urlencoded, as URLSearchParams writes it' },
}

/** Enough for any real URL; past this the table is a scroll you will not read. */
const ROW_CAP = 300

export default function UrlTool() {
  useToolUsageTracker('url')
  const { state, setState, reset } = useToolState<State>('url', INITIAL)

  const deferred = useDeferredValue(state)
  const result = useMemo(
    () => convert(deferred.input, { mode: deferred.mode, variant: deferred.variant, lenient: deferred.lenient }),
    [deferred.input, deferred.mode, deferred.variant, deferred.lenient],
  )
  const parsed = useMemo(() => parseInput(deferred.input), [deferred.input])

  function swap() {
    setState((p) => ({
      ...p,
      mode: p.mode === 'encode' ? 'decode' : 'encode',
      // Feed the output back in: what you want after a swap, and how you peel
      // a second layer off double-encoded input.
      input: result.error === null && result.output !== '' ? result.output : p.input,
    }))
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'URL',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(result.output),
    },
    {
      combo: 'mod+shift+s',
      label: 'Swap encode/decode',
      group: 'URL',
      scope: 'tool',
      whileTyping: true,
      run: swap,
    },
  ])

  const input = deferred.input
  const { output, error } = result

  return (
    <ToolFrame
      slug="url"
      actions={
        <>
          <Segmented
            value={state.mode}
            onChange={(mode) => setState((p) => ({ ...p, mode }))}
            options={[
              { value: 'encode', label: 'Encode' },
              { value: 'decode', label: 'Decode' },
            ]}
          />
          <Select
            value={state.variant}
            onChange={(e) => setState((p) => ({ ...p, variant: e.target.value as Variant }))}
            title={VARIANT_LABELS[state.variant].title}
          >
            {(Object.keys(VARIANT_LABELS) as Variant[]).map((v) => (
              <option key={v} value={v} title={VARIANT_LABELS[v].title}>
                {VARIANT_LABELS[v].label}
              </option>
            ))}
          </Select>
          {state.mode === 'decode' && (
            <Toggle checked={state.lenient} onChange={(v) => setState((p) => ({ ...p, lenient: v }))}>
              Skip malformed
            </Toggle>
          )}
          <Button onClick={swap} title="Swap direction (⌘⇧S)">
            <ArrowLeftRight size={14} aria-hidden />
            Swap
          </Button>
          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <TwoPane
            left={
              <CodeArea
                value={state.input}
                onChange={(e) => setState((p) => ({ ...p, input: e.target.value }))}
                placeholder={
                  state.mode === 'encode'
                    ? 'Paste text or a URL to percent-encode…'
                    : 'Paste a percent-encoded value, query string or URL…'
                }
              />
            }
            right={
              <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
                <CodeArea value={output} readOnly placeholder="Output appears here" />
                {(input !== '' || error !== null) && (
                  <div className="flex shrink-0 flex-col gap-1 border-t border-border px-3 py-1.5 text-[12px] leading-snug">
                    {error !== null && <p className="text-del">{error.message}</p>}
                    {result.warnings.map((w) => (
                      <p key={w.kind} className="text-warn">
                        {w.message}
                      </p>
                    ))}
                    {error === null && (
                      <p className="font-mono text-[11px] text-faint">
                        {formatCount(input.length)} → {formatCount(output.length)} characters
                      </p>
                    )}
                  </div>
                )}
              </div>
            }
          />
        </div>
        {parsed.kind !== 'none' && (
          <ParamsPanel
            parsed={parsed}
            open={state.showParams}
            onToggle={() => setState((p) => ({ ...p, showParams: !p.showParams }))}
          />
        )}
      </div>
    </ToolFrame>
  )
}

function ParamsPanel({
  parsed,
  open,
  onToggle,
}: {
  parsed: Exclude<ParsedInput, { kind: 'none' }>
  open: boolean
  onToggle: () => void
}) {
  const { rows } = parsed
  const shown = rows.length > ROW_CAP ? rows.slice(0, ROW_CAP) : rows
  const normalized = useMemo(() => buildQuery(rows), [rows])
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <section className="flex max-h-[45dvh] shrink-0 flex-col border-t border-border bg-surface">
      <div className="flex shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-medium text-muted hover:text-fg md:min-h-7"
        >
          <Chevron size={14} aria-hidden className="shrink-0" />
          <span className="truncate">
            {parsed.kind === 'url' ? 'URL parts and query' : 'Query'} · {formatCount(rows.length)}{' '}
            {rows.length === 1 ? 'parameter' : 'parameters'}
          </span>
        </button>
        {open && rows.length > 0 && <CopyButton value={normalized} label="Copy normalized" />}
      </div>

      {open && (
        <div className="min-h-0 flex-1 overflow-auto border-t border-border bg-bg scroll-thin">
          {parsed.kind === 'url' && <UrlParts parts={parsed.parts} />}
          {parsed.kind === 'query' && parsed.hash !== '' && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-[12px]">
              <dt className="text-muted">Fragment</dt>
              <dd className="break-all font-mono">{parsed.hash}</dd>
            </dl>
          )}
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-faint">No query parameters.</p>
          ) : (
            <table className="w-full border-collapse font-mono text-[12px] leading-[18px]">
              <thead>
                <tr className="border-b border-border text-left font-sans text-[11px] text-faint">
                  <th className="w-[30%] px-3 py-1 font-medium">Key</th>
                  <th className="px-3 py-1 font-medium">Value</th>
                  <th className="w-px px-3 py-1">
                    <span className="sr-only">Copy</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  // Keys repeat legally; the offset in the query never does.
                  <ParamRow key={row.offset} row={row} />
                ))}
              </tbody>
            </table>
          )}
          {rows.length > ROW_CAP && (
            <p className="border-t border-border px-3 py-1.5 text-[12px] text-faint">
              Showing the first {formatCount(ROW_CAP)} of {formatCount(rows.length)} parameters. Copy normalized
              includes all of them.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function UrlParts({ parts }: { parts: Extract<ParsedInput, { kind: 'url' }>['parts'] }) {
  const credentials =
    parts.hasUsername && parts.hasPassword
      ? 'username and password'
      : parts.hasPassword
        ? 'password'
        : parts.hasUsername
          ? 'username'
          : null
  const items: [string, string][] = [
    ['Protocol', parts.protocol],
    ['Host', parts.hostname || '—'],
    ['Port', parts.port || 'default'],
    ['Path', parts.pathname || '—'],
    ['Fragment', parts.hash || '—'],
  ]
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-[12px]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0 break-all font-mono">{value}</dd>
        </div>
      ))}
      {credentials !== null && (
        <div className="contents">
          <dt className="text-muted">Credentials</dt>
          <dd className="text-warn">Contains a {credentials} (not shown)</dd>
        </div>
      )}
    </dl>
  )
}

function ParamRow({ row }: { row: QueryRow }) {
  return (
    <tr className="border-b border-border align-top last:border-b-0">
      <td className="break-all px-3 py-1.5 text-muted">
        {row.key === '' ? <span className="font-sans text-faint">(empty key)</span> : row.key}
        {row.rawKey !== row.key && <span className="block text-[11px] text-faint">{row.rawKey}</span>}
      </td>
      <td className="break-all px-3 py-1.5">
        {row.value === null ? (
          <span className="font-sans text-faint">flag, no “=”</span>
        ) : row.value === '' ? (
          <span className="font-sans text-faint">empty</span>
        ) : (
          row.value
        )}
        {row.rawValue !== null && row.rawValue !== row.value && (
          <span className="block text-[11px] text-faint">{row.rawValue}</span>
        )}
        {row.malformed && (
          <Badge tone="warn" className="mt-1">
            malformed %, kept as-is
          </Badge>
        )}
      </td>
      <td className="px-3 py-1">
        <CopyButton value={row.value ?? ''} />
      </td>
    </tr>
  )
}
