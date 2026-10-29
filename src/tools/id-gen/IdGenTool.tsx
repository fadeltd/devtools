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
  matchingPreset,
  MAX_COUNT,
  MAX_LENGTH,
  PRESETS,
  generateIds,
  inspectId,
  strength,
  type AlphabetName,
  type IdFormat,
  type IdOptions,
  type LetterCase,
  type UuidVariant,
} from '@fadeltd/devtools-core/id-gen'

const FORMAT_LABELS: Record<IdFormat, string> = {
  random: 'Random string',
  'uuid-v4': 'UUID v4 (random)',
  'uuid-v7': 'UUID v7 (time-ordered)',
  ulid: 'ULID (time-ordered)',
}

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

/** What the entropy figure counts for a standard format, and what it leaves out. */
const ENTROPY_NOTES: Record<Exclude<IdFormat, 'random'>, string> = {
  'uuid-v4': '122 random bits. The other 6 are the version and variant, fixed by the spec.',
  'uuid-v7':
    '62 random bits, in rand_b. The 48-bit timestamp and the 12-bit counter that keeps a batch in order are not entropy.',
  ulid: '80 random bits after a 48-bit timestamp. The prefix adds none either.',
}

const VARIANT_LABELS: Record<UuidVariant, string> = {
  rfc9562: 'RFC 9562',
  ncs: 'NCS (reserved)',
  microsoft: 'Microsoft (reserved)',
  future: 'Reserved',
}

const ERRORS: Record<string, string> = {
  'empty-alphabet': 'The alphabet is empty. Add characters, or turn off “exclude ambiguous”.',
  'invalid-length': `Length must be a whole number between 1 and ${MAX_LENGTH}.`,
  'invalid-count': `Count must be a whole number between 1 and ${MAX_COUNT}.`,
  'time-out-of-range':
    'Your clock reads a time that a 48-bit timestamp cannot hold. Check the system date.',
  'ulid-overflow':
    'The ULID random part ran out within one millisecond. This is astronomically unlikely; generate again.',
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

  // Ephemeral by design: a pasted id is never written anywhere.
  const [probe, setProbe] = useState('')
  const inspection = inspectId(probe)

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

  // Stored state from before formats existed hydrates with the defaults, but a
  // missing format must still mean the original behaviour.
  const format: IdFormat = state.format ?? 'random'
  const isRandom = format === 'random'
  const isUuid = format === 'uuid-v4' || format === 'uuid-v7'

  return (
    <ToolFrame
      slug="id-gen"
      actions={
        <>
          <Select
            value={matchingPreset(state) ?? ''}
            onChange={(e) => {
              const preset = PRESETS.find((p) => p.name === e.target.value)
              if (preset) applyOptions((p) => ({ ...p, ...preset.options }))
            }}
            title="Load a preset"
          >
            <option value="">Custom</option>
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
              <span className="text-[12px] text-muted">Format</span>
              <Select
                className="w-full"
                value={format}
                onChange={(e) => set('format', e.target.value as IdFormat)}
              >
                {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[12px] text-muted">Prefix</span>
              <input
                className={`${field} font-mono`}
                value={state.prefix}
                placeholder={isRandom ? 'sk_live' : 'user'}
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

            {isRandom ? (
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
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-muted">Case</span>
                <Select
                  className="w-full"
                  value={state.letterCase ?? 'canonical'}
                  onChange={(e) => set('letterCase', e.target.value as LetterCase)}
                >
                  <option value="canonical">{isUuid ? 'Standard (lower)' : 'Standard (UPPER)'}</option>
                  <option value="lower">lowercase</option>
                  <option value="upper">UPPERCASE</option>
                </Select>
              </label>
            )}

            {isRandom && (
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
            )}

            {isRandom && state.alphabet === 'custom' && (
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
              {isRandom ? (
                <Toggle
                  checked={state.excludeAmbiguous}
                  onChange={(v) => set('excludeAmbiguous', v)}
                >
                  No 0/O, 1/l/I
                </Toggle>
              ) : isUuid ? (
                <Toggle checked={state.hyphens !== false} onChange={(v) => set('hyphens', v)}>
                  Hyphens
                </Toggle>
              ) : null}
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
            {result.caveat !== undefined && (
              <p className="mt-1.5 text-[12px] leading-snug text-muted">{result.caveat}</p>
            )}
            <p className="mt-1.5 text-[11px] leading-snug text-faint">
              {format === 'random'
                ? `Drawn from ${formatCount(result.alphabetSize)} characters. The prefix adds no entropy — it is public by design.`
                : ENTROPY_NOTES[format]}
            </p>
          </div>

          <div className="panel mt-3 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Inspect an ID</span>
              <input
                className={`${field} font-mono`}
                value={probe}
                placeholder="Paste a UUID or ULID"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setProbe(e.target.value)}
              />
            </label>
            {probe.trim() !== '' &&
              (inspection === null ? (
                <p className="mt-1.5 text-[12px] leading-snug text-muted">Not a UUID or ULID.</p>
              ) : (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                  <dt className="text-muted">Type</dt>
                  <dd className="font-mono">{inspection.label}</dd>
                  {inspection.variant !== undefined && (
                    <>
                      <dt className="text-muted">Variant</dt>
                      <dd className="font-mono">{VARIANT_LABELS[inspection.variant]}</dd>
                    </>
                  )}
                  {inspection.prefix !== '' && (
                    <>
                      <dt className="text-muted">Prefix</dt>
                      <dd className="break-all font-mono">{inspection.prefix}</dd>
                    </>
                  )}
                  {inspection.time !== undefined && (
                    <>
                      <dt className="text-muted">Created</dt>
                      <dd className="break-all font-mono">
                        {inspection.time.iso}
                        <span className="block text-faint">
                          {new Date(inspection.time.ms).toLocaleString()}
                        </span>
                      </dd>
                    </>
                  )}
                  <dd className="col-span-2 mt-0.5 leading-snug text-muted">
                    {inspection.description}
                  </dd>
                </dl>
              ))}
          </div>

          {/* Deliberately not a flex container: flex would make each inline
              child -- both text runs and the <code> -- a separate flex item,
              which is what made this overlap. The icon is inline instead. */}
          <p className="mt-3 text-[11px] leading-[1.6] text-faint">
            <ShieldCheck
              size={12}
              className="mr-1 inline-block shrink-0 align-[-1px] text-add"
              aria-hidden
            />
            Generated with{' '}
            <code className="rounded-[3px] bg-surface-2 px-1 py-px font-mono text-[10px] text-muted">
              crypto.getRandomValues
            </code>{' '}
            and unbiased sampling. Your settings are saved; the generated values and anything you
            inspect never are.
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
