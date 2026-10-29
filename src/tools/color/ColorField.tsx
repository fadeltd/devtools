import { useId } from 'react'
import { cn } from '@/lib/util/cn'
import { describeColor, parseColor, type ColorInfo, type ColorParse, type InputError } from '@fadeltd/devtools-core/color'

export interface ParsedField {
  parse: ColorParse
  info: ColorInfo | null
}

export function parseField(input: string): ParsedField {
  const parse = parseColor(input)
  return { parse, info: parse.ok ? describeColor(parse.color) : null }
}

/** Phones capitalise and "correct" hex digits and color names otherwise. */
const plainText = {
  spellCheck: false,
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
} as const

/**
 * A CSS color text box with a native picker beside it. The text box is the
 * source of truth; the picker only ever writes a hex back into it.
 *
 * Shared by the Color Converter and the Contrast Checker, which both read
 * "any CSS color" the same way.
 */
export function ColorField({
  label,
  value,
  onChange,
  field,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  field: ParsedField
}) {
  const id = useId()
  const { parse, info } = field
  // <input type="color"> takes exactly #rrggbb, so the picker shows the opaque
  // part; the alpha the user typed is carried across when they pick.
  const pickerValue = info === null ? '#000000' : info.css.hex.slice(0, 7)
  const alphaHex = info === null || info.alpha >= 1 ? '' : info.css.hex.slice(7)

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[12px] text-muted">
        {label}
      </label>
      <div className="flex gap-1.5">
        <input
          id={id}
          className="min-h-11 w-full min-w-0 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg placeholder:text-faint md:min-h-7"
          value={value}
          placeholder="#3b82f6, rgb(…), hsl(…), oklch(…), rebeccapurple"
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!parse.ok && parse.error.code !== 'empty'}
          {...plainText}
        />
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value + alphaHex)}
          aria-label={`${label}: pick a color`}
          title="Pick a color"
          className={cn(
            'size-11 shrink-0 cursor-pointer rounded-[4px] border border-border bg-bg p-0.5 md:size-7',
            '[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-xs [&::-webkit-color-swatch]:border-0',
            '[&::-moz-color-swatch]:rounded-xs [&::-moz-color-swatch]:border-0',
          )}
        />
      </div>
      {!parse.ok && parse.error.code !== 'empty' && <ErrorLine input={value} error={parse.error} />}
      {parse.ok && parse.notes.length > 0 && (
        <ul className="text-[12px] leading-snug text-muted">
          {parse.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The message, plus the input around the bad character with it marked. */
function ErrorLine({ input, error }: { input: string; error: InputError }) {
  const at = error.index
  const len = error.char?.length ?? 1
  const context =
    at === undefined
      ? null
      : {
          before: (at > 24 ? '…' : '') + input.slice(Math.max(0, at - 24), at),
          bad: input.slice(at, at + len),
          after: input.slice(at + len, at + len + 24),
        }
  return (
    <div className="rounded-[4px] border border-del/40 bg-del-bg px-2 py-1.5 text-[12px] text-del" role="alert">
      <div>
        {at !== undefined && <span className="font-mono">Position {at + 1}: </span>}
        {error.message}
      </div>
      {context !== null && (
        <div className="mt-1 break-all font-mono text-[12px] text-muted">
          {context.before}
          {/* Past the end (a missing ")") there is no character; mark a space. */}
          <span className="rounded-xs bg-del px-px text-bg">{context.bad === '' ? ' ' : context.bad}</span>
          {context.after}
        </div>
      )}
    </div>
  )
}
