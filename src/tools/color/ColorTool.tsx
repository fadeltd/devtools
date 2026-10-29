import { useMemo, type ReactNode } from 'react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatNumber } from '@fadeltd/devtools-core/color'
import { ColorField, parseField } from './ColorField'
import { Swatch } from './Swatch'

interface State {
  input: string
}

const INITIAL: State = { input: '#3b82f6' }

/** Label, mono value, copy. The label sits above the value on a phone. */
function Row({ label, value, note }: { label: ReactNode; value: string; note?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="min-w-0 flex-1 md:flex md:items-baseline md:gap-3">
        <div className="text-[12px] text-muted md:w-32 md:shrink-0">{label}</div>
        <div className="min-w-0">
          <div className="select-all break-all font-mono text-[13px]">{value}</div>
          {note !== undefined && <div className="text-[11px] text-faint">{note}</div>}
        </div>
      </div>
      <CopyButton value={value} />
    </div>
  )
}

export default function ColorTool() {
  useToolUsageTracker('color')
  const { state, setState, reset } = useToolState<State>('color', INITIAL)

  // Parsing one short string is microseconds; no need to defer it.
  const field = useMemo(() => parseField(state.input), [state.input])
  const info = field.info

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy hex',
      group: 'Color Converter',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(info?.css.hex ?? ''),
    },
  ])

  const translucent = info !== null && info.alpha < 1
  const clippedNote = info !== null && !info.inGamut ? 'nearest in sRGB' : undefined

  return (
    <ToolFrame
      slug="color"
      actions={
        <Button variant="ghost" onClick={reset}>
          Reset
        </Button>
      }
    >
      <div className="h-full overflow-auto scroll-thin">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
          <section className="panel flex flex-col gap-3 p-3 md:flex-row">
            <div className="flex h-32 shrink-0 gap-1.5 md:h-auto md:min-h-32 md:w-56">
              {info === null ? (
                <div className="flex-1 rounded-[4px] border border-dashed border-border" aria-hidden />
              ) : !info.inGamut ? (
                // Two halves: the browser paints the oklch() as written (on a
                // wide-gamut screen that is the real color), beside the sRGB
                // color the hex / rgb / hsl rows describe.
                <>
                  <SwatchWithCaption caption="As written">
                    <Swatch css={info.css.oklch} translucent={translucent} className="flex-1" />
                  </SwatchWithCaption>
                  <SwatchWithCaption caption="In sRGB">
                    <Swatch css={info.css.hex} translucent={translucent} className="flex-1" />
                  </SwatchWithCaption>
                </>
              ) : (
                <Swatch css={info.css.hex} translucent={translucent} className="flex-1" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <ColorField
                label="Any CSS color"
                value={state.input}
                onChange={(v) => setState((p) => ({ ...p, input: v }))}
                field={field}
              />
              {field.parse.ok || field.parse.error.code !== 'empty' ? null : (
                <p className="text-[12px] text-muted">
                  Type or paste a hex code, rgb(), hsl(), oklch() or a CSS color name, or use the picker.
                </p>
              )}
            </div>
          </section>

          {info !== null && (
            <section className="panel p-3">
              {!info.inGamut && (
                <p className="mb-2 text-[12px] leading-snug text-muted">
                  <Badge tone="warn" className="mr-1.5 align-px">
                    Out of sRGB gamut
                  </Badge>
                  Hex, RGB and HSL can't show this color. They show the nearest one sRGB can: the same lightness
                  and hue, with chroma lowered from {formatNumber(info.oklch.c, 4)} to{' '}
                  {formatNumber(info.clipped?.c ?? 0, 4)}.
                </p>
              )}
              <div className="divide-y divide-border/60">
                <Row label="HEX" value={info.css.hex} note={clippedNote} />
                <Row label="RGB" value={info.css.rgb} note={clippedNote} />
                <Row label="HSL" value={info.css.hsl} note={clippedNote} />
                <Row label="OKLCH" value={info.css.oklch} note={info.inGamut ? undefined : 'as written'} />
                {info.css.clippedOklch !== null && (
                  <Row label="OKLCH in sRGB" value={info.css.clippedOklch} note="chroma lowered to fit" />
                )}
                {translucent && (
                  <Row
                    label="Alpha"
                    value={formatNumber(info.alpha, 3)}
                    note={`${formatNumber(info.alpha * 100, 1)}% opaque`}
                  />
                )}
                {info.names.length > 0 && (
                  <Row
                    label={info.names.length > 1 ? 'Names' : 'Name'}
                    value={info.names[0]!}
                    note={info.names.length > 1 ? `also ${info.names.slice(1).join(', ')}` : undefined}
                  />
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </ToolFrame>
  )
}

function SwatchWithCaption({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {children}
      <span className="text-center text-[11px] text-faint">{caption}</span>
    </div>
  )
}
