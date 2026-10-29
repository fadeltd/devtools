import { useDeferredValue, useMemo, type ReactNode } from 'react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useToolUsageTracker } from '@/lib/prefs'
import {
  baseName,
  convertBase,
  formatLike,
  fromBits,
  groupDigits,
  groupThousands,
  parseByteSize,
  parsePermissions,
  type InputError,
  type PermMatrix,
  type SpecialBits,
} from '@fadeltd/devtools-core/number'

interface State {
  baseInput: string
  fromBase: number
  customBase: number
  bytesInput: string
  permsInput: string
}

const INITIAL: State = {
  baseInput: '255',
  fromBase: 10,
  customBase: 3,
  bytesInput: '1.5 GB',
  permsInput: '755',
}

const NAMED_BASES = [2, 8, 10, 16, 36]
const OTHER_BASES = Array.from({ length: 35 }, (_, i) => i + 2).filter((b) => !NAMED_BASES.includes(b))

const EMPTY_MATRIX: PermMatrix = [
  [false, false, false],
  [false, false, false],
  [false, false, false],
]
const NO_SPECIAL: SpecialBits = { setuid: false, setgid: false, sticky: false }
const WHO = ['Owner', 'Group', 'Other'] as const
const RWX = ['r', 'w', 'x'] as const
// The grid shows bare r/w/x, so each checkbox gets a full name for screen readers.
const RWX_NAMES = ['read', 'write', 'execute'] as const

const field =
  'min-h-11 w-full min-w-0 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg md:min-h-7'

/** Phones capitalise and "correct" rwxr-xr-x and hex digits otherwise. */
const plainText = {
  spellCheck: false,
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
} as const

const bits = (n: number) => `${n} ${n === 1 ? 'bit' : 'bits'}`

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-3">
      <h2 className="pb-2 text-[11px] font-semibold uppercase tracking-[0.02em] text-faint">{title}</h2>
      {children}
    </section>
  )
}

/** Label, mono value, copy. The label sits above the value on a phone. */
function Row({
  label,
  display,
  value,
  muted,
  actions,
}: {
  label: ReactNode
  display?: ReactNode
  value: string
  muted?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="min-w-0 flex-1 md:flex md:items-baseline md:gap-3">
        <div className="text-[12px] text-muted md:w-32 md:shrink-0">{label}</div>
        <div className="min-w-0">
          <div className="break-all font-mono text-[13px] tabular-nums">{display ?? value}</div>
          {muted !== undefined && <div className="break-all font-mono text-[11px] text-faint">{muted}</div>}
        </div>
      </div>
      {actions ?? <CopyButton value={value} />}
    </div>
  )
}

/** The message, plus the input around the bad character with it marked. */
function ErrorLine({ input, error }: { input: string; error: InputError }) {
  const at = error.index
  const context =
    at === undefined
      ? null
      : {
          before: (at > 24 ? '…' : '') + input.slice(Math.max(0, at - 24), at),
          bad: input.slice(at, at + (error.char?.length ?? 1)),
          after: input.slice(at + (error.char?.length ?? 1), at + 24),
        }
  return (
    <div className="mt-2 rounded-[4px] border border-del/40 bg-del-bg px-2 py-1.5 text-[12px] text-del" role="alert">
      <div>
        {at !== undefined && <span className="font-mono">Position {at + 1}: </span>}
        {error.message}
      </div>
      {context !== null && (
        <div className="mt-1 break-all font-mono text-[12px] text-muted">
          {context.before}
          <span className="rounded-xs bg-del px-px text-bg">{context.bad === '' ? ' ' : context.bad}</span>
          {context.after}
        </div>
      )}
    </div>
  )
}

function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' }) {
  return <p className={`mt-2 text-[12px] leading-snug ${tone === 'warn' ? 'text-warn' : 'text-muted'}`}>{children}</p>
}

function BaseSection({
  state,
  set,
}: {
  state: State
  set: <K extends keyof State>(key: K, value: State[K]) => void
}) {
  // Conversions of a long paste are BigInt work proportional to its length;
  // deferring keeps typing in the box responsive.
  const input = useDeferredValue(state.baseInput)
  const result = useMemo(
    () => convertBase(input, state.fromBase, state.customBase),
    [input, state.fromBase, state.customBase],
  )

  return (
    <Section title="Number base">
      <div className="flex flex-col gap-2 md:flex-row">
        <input
          className={field}
          value={state.baseInput}
          placeholder="255, 0xff, -0b1010, 1_000_000"
          aria-label="Number"
          onChange={(e) => set('baseInput', e.target.value)}
          {...plainText}
        />
        <Select
          value={state.fromBase}
          onChange={(e) => set('fromBase', Number(e.target.value))}
          aria-label="From base"
          title="Base of the input (a 0x / 0b / 0o prefix overrides it)"
        >
          {NAMED_BASES.map((b) => (
            <option key={b} value={b}>
              From {b === 36 ? 'base 36' : baseName(b)}
            </option>
          ))}
          <optgroup label="Other">
            {OTHER_BASES.map((b) => (
              <option key={b} value={b}>
                From base {b}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>

      {!result.ok ? (
        <ErrorLine input={input} error={result.error} />
      ) : (
        <>
          {result.prefix !== null && result.base !== state.fromBase && (
            <Note>
              Read as {baseName(result.base)} because of the <code className="font-mono">{result.prefix}</code>{' '}
              prefix.
            </Note>
          )}
          <div className="mt-2 divide-y divide-border/60">
            <Row label="Binary" value={result.outputs.bin} display={groupDigits(result.outputs.bin, 4)} />
            <Row label="Octal" value={result.outputs.oct} />
            <Row label="Decimal" value={result.outputs.dec} display={groupDigits(result.outputs.dec, 3, ',')} />
            <Row label="Hex" value={result.outputs.hex} />
            <Row label="Base 36" value={result.outputs.base36} />
            <Row
              label={
                <label className="flex items-center gap-2">
                  <span>Base</span>
                  <Select
                    value={state.customBase}
                    onChange={(e) => set('customBase', Number(e.target.value))}
                    aria-label="Custom output base"
                  >
                    {Array.from({ length: 35 }, (_, i) => i + 2).map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </Select>
                </label>
              }
              value={result.outputs.custom}
            />
          </div>
          <Note>
            {result.negative
              ? `${bits(result.bitLength)} of magnitude; ${bits(result.signedBitLength)} as two’s complement.`
              : `${bits(result.bitLength)} unsigned; ${bits(result.signedBitLength)} signed.`}
          </Note>

          {result.twos.length > 0 && (
            <>
              <h3 className="pt-3 text-[12px] font-medium text-fg">Two’s complement</h3>
              <div className="mt-1 divide-y divide-border/60">
                {result.twos.map((t) =>
                  t.fits ? (
                    <Row
                      key={t.bits}
                      label={`${t.bits}-bit`}
                      value={t.hex}
                      muted={groupDigits(t.bin, 4)}
                      actions={
                        <div className="flex shrink-0 gap-1">
                          <CopyButton value={t.hex} label="Hex" />
                          <CopyButton value={t.bin} label="Bin" />
                        </div>
                      }
                    />
                  ) : (
                    <Row
                      key={t.bits}
                      label={`${t.bits}-bit`}
                      value=""
                      display={
                        <span className="font-sans text-[12px] text-faint">
                          Doesn’t fit (needs {bits(result.signedBitLength)})
                        </span>
                      }
                      actions={<span />}
                    />
                  ),
                )}
              </div>
            </>
          )}
        </>
      )}
    </Section>
  )
}

function BytesSection({ state, set }: { state: State; set: <K extends keyof State>(key: K, value: State[K]) => void }) {
  const result = useMemo(() => parseByteSize(state.bytesInput), [state.bytesInput])

  return (
    <Section title="Byte size">
      <input
        className={field}
        value={state.bytesInput}
        placeholder="1536, 1.5 GB, 512 KiB, 2 TB"
        aria-label="Byte size"
        onChange={(e) => set('bytesInput', e.target.value)}
        {...plainText}
      />

      {!result.ok ? (
        <ErrorLine input={state.bytesInput} error={result.error} />
      ) : (
        <>
          {result.ambiguous && (
            <Note tone="warn">
              A bare “{result.unit.symbol[0]}” is ambiguous. Read as {result.unit.symbol} (1024-based, as{' '}
              <code className="font-mono">ls -h</code> means it); write {result.unit.symbol[0] === 'K' ? 'kB' : `${result.unit.symbol[0]}B`}{' '}
              for the 1000-based unit.
            </Note>
          )}
          {result.rounded && <Note tone="warn">That is a fraction of a byte; rounded to the nearest whole byte.</Note>}
          <div className="mt-2 divide-y divide-border/60">
            <Row label="Bytes" value={result.bytes.toString()} display={groupThousands(result.bytes)} />
          </div>
          <div className="grid gap-x-6 md:grid-cols-2">
            {(
              [
                ['SI (×1000)', result.si],
                ['IEC (×1024)', result.iec],
              ] as const
            ).map(([title, rows]) => (
              <div key={title}>
                <h3 className="pt-3 text-[12px] font-medium text-fg">{title}</h3>
                <div className="mt-1 divide-y divide-border/60">
                  {rows.map((s) => (
                    <Row
                      key={s.unit}
                      label={s.unit}
                      value={`${s.value} ${s.unit}`}
                      display={`${s.exact ? '' : '≈ '}${s.value}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Note>
            {result.humanIec === result.humanSi ? result.humanIec : `${result.humanIec} = ${result.humanSi}`}. 1{' '}
            {result.gap.iec} is {result.gap.percent}% larger than 1 {result.gap.si}.
          </Note>
        </>
      )}
    </Section>
  )
}

function PermsSection({ state, set }: { state: State; set: <K extends keyof State>(key: K, value: State[K]) => void }) {
  const result = useMemo(() => parsePermissions(state.permsInput), [state.permsInput])
  const matrix = result.ok ? result.matrix : EMPTY_MATRIX
  const special = result.ok ? result.special : NO_SPECIAL
  const fileType = result.ok ? result.fileType : null

  // Writing back in the user's own format is what keeps the two sides in
  // sync without a second source of truth: the text is the state, and the
  // grid is derived from it.
  const apply = (nextMatrix: PermMatrix, nextSpecial: SpecialBits) =>
    set('permsInput', formatLike(state.permsInput, fromBits(nextMatrix, nextSpecial, fileType)))

  const toggleBit = (who: number, bit: number, on: boolean) => {
    const next = matrix.map((row, w) => row.map((v, b) => (w === who && b === bit ? on : v))) as PermMatrix
    apply(next, special)
  }

  return (
    <Section title="Unix permissions">
      <input
        className={field}
        value={state.permsInput}
        placeholder="755, 0644, 4755, rwxr-xr-x, drwxr-xr-t"
        aria-label="Permissions"
        onChange={(e) => set('permsInput', e.target.value)}
        {...plainText}
      />
      {!result.ok && <ErrorLine input={state.permsInput} error={result.error} />}

      <div className="mt-2 flex flex-col gap-3 md:flex-row md:gap-8">
        <div className="grid w-fit grid-cols-[4rem_repeat(3,auto)] items-center gap-x-4">
          {WHO.map((who, w) => (
            <div key={who} className="contents">
              <span className="text-[12px] text-muted">{who}</span>
              {RWX.map((letter, b) => (
                <Toggle
                  key={letter}
                  checked={matrix[w]?.[b] === true}
                  onChange={(v) => toggleBit(w, b, v)}
                  aria-label={`${who} ${RWX_NAMES[b]}`}
                >
                  <span className="font-mono">{letter}</span>
                </Toggle>
              ))}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 md:flex-col md:justify-center md:gap-x-0">
          <Toggle checked={special.setuid} onChange={(v) => apply(matrix, { ...special, setuid: v })}>
            setuid
          </Toggle>
          <Toggle checked={special.setgid} onChange={(v) => apply(matrix, { ...special, setgid: v })}>
            setgid
          </Toggle>
          <Toggle checked={special.sticky} onChange={(v) => apply(matrix, { ...special, sticky: v })}>
            sticky
          </Toggle>
        </div>
      </div>

      {result.ok && (
        <div className="mt-2 divide-y divide-border/60">
          <Row label="Octal" value={result.octal} />
          <Row label="Symbolic" value={result.symbolic} />
          {result.fileType !== null && <Row label="ls -l" value={result.fileType + result.symbolic} />}
          <Row label="chmod" value={result.chmod.octal} />
          <Row label="chmod (symbolic)" value={result.chmod.symbolic} />
        </div>
      )}
    </Section>
  )
}

export default function NumberTool() {
  useToolUsageTracker('number')
  const { state, setState, reset } = useToolState<State>('number', INITIAL)
  const set = <K extends keyof State>(key: K, value: State[K]) => setState((p) => ({ ...p, [key]: value }))

  return (
    <ToolFrame
      slug="number"
      actions={
        <Button variant="ghost" onClick={reset}>
          Reset
        </Button>
      }
    >
      <div className="h-full overflow-auto scroll-thin">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
          <BaseSection state={state} set={set} />
          <BytesSection state={state} set={set} />
          <PermsSection state={state} set={set} />
        </div>
      </div>
    </ToolFrame>
  )
}
