import type { ReactNode } from 'react'
import { CodeArea } from '@/components/ui/CodeArea'
import { Select, Toggle } from '@/components/ui/Select'
import { CASE_LABELS } from './core/ops'
import type { BlankPolicy, CaseTarget, LineTest, Op, SortMode } from './core/types'

const field = 'min-h-11 w-full rounded-[4px] border border-border bg-bg px-2 font-mono text-fg md:min-h-7'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 basis-24 flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  )
}

function Text({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <Field label={label}>
      <input
        className={field}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

/** An empty or non-numeric field keeps the last good value instead of NaN. */
function Num({
  label,
  value,
  onChange,
  min,
  optional = false,
}: {
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  min?: number
  optional?: boolean
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        className={field}
        value={value ?? ''}
        placeholder={optional ? 'end' : undefined}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') {
            if (optional) onChange(undefined)
            return
          }
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(n)
        }}
      />
    </Field>
  )
}

function testFor(t: LineTest['t']): LineTest {
  switch (t) {
    case 'contains':
      return { t, needle: '', ci: true }
    case 'regex':
      return { t, source: '', flags: 'i' }
    case 'index':
      return { t, ranges: '1-10' }
    case 'blank':
    case 'duplicate':
      return { t }
  }
}

/** The per-kind settings inside a step card. Pure presentation over an Op. */
export function OpControls({ op, onChange }: { op: Op; onChange: (op: Op) => void }) {
  switch (op.kind) {
    case 'sort':
      return (
        <>
          <Select
            value={op.mode}
            onChange={(e) => onChange({ ...op, mode: e.target.value as SortMode })}
            title="Sort mode"
          >
            <option value="natural">Natural (numbers in order)</option>
            <option value="locale">Alphabetical</option>
            <option value="codepoint">Codepoint (byte order)</option>
            <option value="length">Line length</option>
          </Select>
          <Select
            value={op.blanks}
            onChange={(e) => onChange({ ...op, blanks: e.target.value as BlankPolicy })}
            title="Blank lines"
          >
            <option value="keep">Blanks: in order</option>
            <option value="first">Blanks: first</option>
            <option value="last">Blanks: last</option>
            <option value="drop">Blanks: remove</option>
          </Select>
          <Toggle
            checked={op.order === 'desc'}
            onChange={(v) => onChange({ ...op, order: v ? 'desc' : 'asc' })}
          >
            Descending
          </Toggle>
          <Toggle checked={op.caseSensitive} onChange={(v) => onChange({ ...op, caseSensitive: v })}>
            Case sensitive
          </Toggle>
        </>
      )

    case 'dedupe':
      return (
        <>
          <Select
            value={op.output}
            onChange={(e) => onChange({ ...op, output: e.target.value as typeof op.output })}
          >
            <option value="unique">Keep unique lines</option>
            <option value="duplicates-only">Show only duplicates</option>
            <option value="unique-only">Show only non-repeated</option>
            <option value="with-counts">Prefix with counts</option>
          </Select>
          {op.output === 'unique' && (
            <Select
              value={op.keep}
              onChange={(e) => onChange({ ...op, keep: e.target.value as 'first' | 'last' })}
            >
              <option value="first">Keep first</option>
              <option value="last">Keep last</option>
            </Select>
          )}
          <Toggle checked={op.caseSensitive} onChange={(v) => onChange({ ...op, caseSensitive: v })}>
            Case sensitive
          </Toggle>
          <Toggle checked={op.trimKey} onChange={(v) => onChange({ ...op, trimKey: v })}>
            Ignore surrounding spaces
          </Toggle>
        </>
      )

    case 'filter': {
      const test = op.test
      return (
        <>
          <Select
            value={op.action}
            onChange={(e) => onChange({ ...op, action: e.target.value as 'keep' | 'remove' })}
          >
            <option value="keep">Keep</option>
            <option value="remove">Remove</option>
          </Select>
          <Select
            value={test.t}
            onChange={(e) => onChange({ ...op, test: testFor(e.target.value as LineTest['t']) })}
          >
            <option value="contains">lines containing</option>
            <option value="regex">lines matching a regex</option>
            <option value="blank">blank lines</option>
            <option value="index">line numbers</option>
            <option value="duplicate">repeated lines</option>
          </Select>
          {test.t === 'contains' && (
            <>
              <Text
                label="Text"
                value={test.needle}
                onChange={(needle) => onChange({ ...op, test: { ...test, needle } })}
              />
              <Toggle checked={test.ci} onChange={(ci) => onChange({ ...op, test: { ...test, ci } })}>
                Ignore case
              </Toggle>
            </>
          )}
          {test.t === 'regex' && (
            <>
              <Text
                label="Pattern"
                value={test.source}
                placeholder="^sk_(live|test)_"
                onChange={(source) => onChange({ ...op, test: { ...test, source } })}
              />
              <Text
                label="Flags"
                value={test.flags}
                placeholder="i"
                onChange={(flags) => onChange({ ...op, test: { ...test, flags } })}
              />
            </>
          )}
          {test.t === 'index' && (
            <Text
              label="Lines (1-based)"
              value={test.ranges}
              placeholder="1-10, 15, 20-25"
              onChange={(ranges) => onChange({ ...op, test: { ...test, ranges } })}
            />
          )}
        </>
      )
    }

    case 'case':
      return (
        <Select
          value={op.target}
          onChange={(e) => onChange({ ...op, target: e.target.value as CaseTarget })}
        >
          {(Object.keys(CASE_LABELS) as CaseTarget[]).map((t) => (
            <option key={t} value={t}>
              {CASE_LABELS[t]}
            </option>
          ))}
        </Select>
      )

    case 'affix':
      return (
        <>
          <Text
            label="Prefix"
            value={op.prefix}
            placeholder="sk_live_"
            onChange={(prefix) => onChange({ ...op, prefix })}
          />
          <Text label="Suffix" value={op.suffix} onChange={(suffix) => onChange({ ...op, suffix })} />
          <Toggle checked={op.skipBlank} onChange={(skipBlank) => onChange({ ...op, skipBlank })}>
            Skip blank lines
          </Toggle>
        </>
      )

    case 'trim':
      return (
        <>
          <Toggle checked={op.leading} onChange={(leading) => onChange({ ...op, leading })}>
            Leading
          </Toggle>
          <Toggle checked={op.trailing} onChange={(trailing) => onChange({ ...op, trailing })}>
            Trailing
          </Toggle>
          <Toggle
            checked={op.collapseInternal}
            onChange={(collapseInternal) => onChange({ ...op, collapseInternal })}
          >
            Collapse inner runs
          </Toggle>
        </>
      )

    case 'number':
      return (
        <>
          <Num label="Start" value={op.start} onChange={(v) => onChange({ ...op, start: v ?? 1 })} />
          <Num label="Step" value={op.step} onChange={(v) => onChange({ ...op, step: v ?? 1 })} />
          <Num
            label="Pad to width"
            min={0}
            value={op.pad}
            onChange={(v) => onChange({ ...op, pad: Math.max(0, v ?? 0) })}
          />
          <Text
            label="Pad with"
            value={op.padChar}
            onChange={(padChar) => onChange({ ...op, padChar: [...padChar].slice(-1).join('') })}
          />
          <Text
            label="Separator"
            value={op.separator}
            onChange={(separator) => onChange({ ...op, separator })}
          />
          <Select
            value={op.position}
            onChange={(e) => onChange({ ...op, position: e.target.value as 'prefix' | 'suffix' })}
          >
            <option value="prefix">Before line</option>
            <option value="suffix">After line</option>
          </Select>
          <Toggle checked={op.skipBlank} onChange={(skipBlank) => onChange({ ...op, skipBlank })}>
            Skip blank lines
          </Toggle>
        </>
      )

    case 'join':
      return (
        <>
          <Text
            label="Separator"
            value={op.separator}
            onChange={(separator) => onChange({ ...op, separator })}
          />
          <Num
            label="Lines per row"
            min={1}
            optional
            value={op.chunkSize}
            onChange={(chunkSize) => {
              const { chunkSize: _, ...rest } = op
              onChange(chunkSize === undefined ? rest : { ...rest, chunkSize })
            }}
          />
        </>
      )

    case 'split': {
      const by = op.by
      return (
        <>
          <Select
            value={by.t}
            onChange={(e) =>
              onChange({
                ...op,
                by:
                  e.target.value === 'regex'
                    ? { t: 'regex', source: '\\s*,\\s*', flags: '' }
                    : { t: 'literal', s: ',' },
              })
            }
          >
            <option value="literal">On text</option>
            <option value="regex">On regex</option>
          </Select>
          {by.t === 'literal' ? (
            <Text label="Separator" value={by.s} onChange={(s) => onChange({ ...op, by: { ...by, s } })} />
          ) : (
            <>
              <Text
                label="Pattern"
                value={by.source}
                onChange={(source) => onChange({ ...op, by: { ...by, source } })}
              />
              <Text
                label="Flags"
                value={by.flags}
                onChange={(flags) => onChange({ ...op, by: { ...by, flags } })}
              />
            </>
          )}
        </>
      )
    }

    case 'wrap':
      return (
        <>
          <Num
            label="Width"
            min={1}
            value={op.width}
            onChange={(v) => onChange({ ...op, width: Math.max(1, v ?? 80) })}
          />
          <Toggle checked={op.breakWords} onChange={(breakWords) => onChange({ ...op, breakWords })}>
            Break long words
          </Toggle>
          <Toggle
            checked={op.preserveIndent}
            onChange={(preserveIndent) => onChange({ ...op, preserveIndent })}
          >
            Keep indent
          </Toggle>
        </>
      )

    case 'slice':
      // Shown 1-based and inclusive, as people count lines; stored as slice().
      return (
        <>
          <Num
            label="From line"
            min={1}
            value={op.from + 1}
            onChange={(v) => onChange({ ...op, from: Math.max(0, (v ?? 1) - 1) })}
          />
          <Num
            label="To line"
            min={1}
            optional
            value={op.to}
            onChange={(to) => {
              const { to: _, ...rest } = op
              onChange(to === undefined ? rest : { ...rest, to })
            }}
          />
        </>
      )

    case 'setop':
      return (
        <>
          <Select
            value={op.op}
            onChange={(e) => onChange({ ...op, op: e.target.value as typeof op.op })}
          >
            <option value="intersection">Keep lines also in…</option>
            <option value="difference">Remove lines also in…</option>
            <option value="union">Add lines from…</option>
            <option value="symmetric-difference">Lines in exactly one</option>
          </Select>
          <Toggle checked={op.caseSensitive} onChange={(caseSensitive) => onChange({ ...op, caseSensitive })}>
            Case sensitive
          </Toggle>
          <Toggle checked={op.bag} onChange={(bag) => onChange({ ...op, bag })}>
            Count repeats
          </Toggle>
          <CodeArea
            value={op.other}
            onChange={(e) => onChange({ ...op, other: e.target.value })}
            placeholder="The other list, one item per line…"
            className="h-28 basis-full rounded-[4px] border border-border p-2"
          />
        </>
      )

    case 'normalize':
      return (
        <Select
          value={op.form}
          onChange={(e) => onChange({ ...op, form: e.target.value as typeof op.form })}
        >
          <option value="NFC">NFC (composed)</option>
          <option value="NFD">NFD (decomposed)</option>
          <option value="NFKC">NFKC (compatibility, composed)</option>
          <option value="NFKD">NFKD (compatibility, decomposed)</option>
        </Select>
      )

    case 'shuffle':
    case 'reverse':
      return null
  }
}
