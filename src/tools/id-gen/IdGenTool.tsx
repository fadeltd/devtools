import { useCallback, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import {
  DEFAULT_OPTIONS,
  MAX_COUNT,
  MAX_LENGTH,
  PRESETS,
  generateIds,
  strength,
  type AlphabetName,
  type IdOptions,
} from './core/generate'

const ALPHABET_LABELS: Record<AlphabetName | 'custom', string> = {
  alphanumeric: 'Alphanumeric (A–Z a–z 0–9)',
  lowercase: 'Lowercase + digits',
  uppercase: 'Uppercase + digits',
  letters: 'Letters only',
  numeric: 'Digits only',
  hex: 'Hexadecimal',
  base58: 'Base58 (no 0 O I l)',
  password: 'Alphanumeric + symbols',
  custom: 'Custom…',
}

const ERRORS: Record<string, string> = {
  'empty-alphabet': 'The alphabet is empty. Add characters, or turn off “exclude ambiguous”.',
  'invalid-length': `Length must be a whole number between 1 and ${MAX_LENGTH}.`,
  'invalid-count': `Count must be a whole number between 1 and ${MAX_COUNT}.`,
}

export default function IdGenTool() {
  useToolUsageTracker('id-gen')

  // Only the OPTIONS persist. Generated values are secrets and live in
  // component state, so they are never written to disk under any code path.
  const { state, setState, reset } = useToolState<IdOptions>('id-gen', DEFAULT_OPTIONS)

  // Generating is an action, not a derivation -- both changing an option and
  // pressing Generate are user events, so the result is state updated from
  // those handlers rather than a memo with an artificial dependency.
  const [result, setResult] = useState(() => generateIds(state))

  const regenerate = useCallback(() => setResult(generateIds(state)), [state])

  const applyOptions = useCallback(
    (update: (prev: IdOptions) => IdOptions) => {
      setState((prev) => {
        const next = update(prev)
        setResult(generateIds(next))
        return next
      })
    },
    [setState],
  )

  const ids = result.ids
  const output = ids.join('\n')
  const verdict = strength(result.entropyBits)

  useShortcuts([
    {
      combo: 'mod+enter',
      label: 'Generate again',
      group: 'ID generator',
      scope: 'tool',
      whileTyping: true,
      run: regenerate,
    },
    {
      combo: 'mod+shift+c',
      label: 'Copy all',
      group: 'ID generator',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
  ])

  const set = <K extends keyof IdOptions>(key: K, value: IdOptions[K]) =>
    applyOptions((p) => ({ ...p, [key]: value }))

  const field = 'min-h-11 w-full rounded-[4px] border border-border bg-bg px-2 text-fg md:min-h-7'

  return (
    <ToolFrame
      slug="id-gen"
      actions={
        <>
          <Select
            value=""
            onChange={(e) => {
              const preset = PRESETS.find((p) => p.name === e.target.value)
              if (preset) applyOptions((p) => ({ ...p, ...preset.options }))
            }}
            title="Load a preset"
          >
            <option value="">Preset…</option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name} title={p.description}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button variant="primary" onClick={regenerate} title="Generate again (⌘⏎)">
            <RefreshCw size={14} aria-hidden />
            Generate
          </Button>
          <CopyButton value={output} label="Copy all" />
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              setResult(generateIds(DEFAULT_OPTIONS))
            }}
          >
            Reset
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <div className="w-full shrink-0 overflow-y-auto border-b border-border p-3 scroll-thin md:w-[320px] md:border-b-0 md:border-r">
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[12px] text-muted">Prefix</span>
              <input
                className={`${field} font-mono`}
                value={state.prefix}
                placeholder="sk_live"
                onChange={(e) => set('prefix', e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Separator</span>
              <input
                className={`${field} font-mono`}
                value={state.separator}
                placeholder="_"
                onChange={(e) => set('separator', e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Random length</span>
              <input
                type="number"
                min={1}
                max={MAX_LENGTH}
                className={`${field} font-mono`}
                value={state.length}
                onChange={(e) => set('length', Number(e.target.value))}
              />
            </label>

            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[12px] text-muted">Alphabet</span>
              <Select
                className="w-full"
                value={state.alphabet}
                onChange={(e) => set('alphabet', e.target.value as IdOptions['alphabet'])}
              >
                {Object.entries(ALPHABET_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>

            {state.alphabet === 'custom' && (
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-[12px] text-muted">Characters to draw from</span>
                <input
                  className={`${field} font-mono`}
                  value={state.customAlphabet ?? ''}
                  placeholder="abcdef0123456789"
                  onChange={(e) => set('customAlphabet', e.target.value)}
                />
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">How many</span>
              <input
                type="number"
                min={1}
                max={MAX_COUNT}
                className={`${field} font-mono`}
                value={state.count}
                onChange={(e) => set('count', Number(e.target.value))}
              />
            </label>

            <div className="flex items-end">
              <Toggle
                checked={state.excludeAmbiguous}
                onChange={(v) => set('excludeAmbiguous', v)}
              >
                No 0/O, 1/l/I
              </Toggle>
            </div>
          </div>

          <div className="panel mt-3 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] text-muted">Entropy</span>
              <span className="font-mono text-[13px] tabular-nums">
                {result.entropyBits.toFixed(0)} bits
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="h-1.5 min-w-0 flex-1 rounded-[2px] bg-surface-2" aria-hidden>
                <span
                  className={`block h-full rounded-[2px] ${
                    verdict.level === 'weak'
                      ? 'bg-del'
                      : verdict.level === 'fair'
                        ? 'bg-warn'
                        : 'bg-add'
                  }`}
                  style={{ width: `${Math.min(100, (result.entropyBits / 160) * 100)}%` }}
                />
              </span>
              <Badge
                tone={
                  verdict.level === 'weak' ? 'del' : verdict.level === 'fair' ? 'warn' : 'add'
                }
              >
                {verdict.label}
              </Badge>
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-muted">{verdict.detail}</p>
            <p className="mt-1.5 text-[11px] leading-snug text-faint">
              Drawn from {formatCount(result.alphabetSize)} characters. The prefix adds no
              entropy — it is public by design.
            </p>
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-faint">
            <ShieldCheck size={13} className="mt-px shrink-0 text-add" aria-hidden />
            Generated with <code className="font-mono">crypto.getRandomValues</code> and unbiased
            sampling. Your settings are saved; the generated values never are.
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {result.error !== undefined ? (
            <div className="flex-1 p-3 font-mono text-[13px] text-del">
              {ERRORS[result.error] ?? 'Invalid options.'}
            </div>
          ) : (
            <CodeArea value={output} readOnly placeholder="Generated ids appear here" />
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
            <span>{formatCount(ids.length)} generated</span>
            {ids[0] !== undefined && <span>{ids[0].length} characters each</span>}
          </div>
        </div>
      </div>
    </ToolFrame>
  )
}
