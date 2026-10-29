import { useMemo, type ReactNode } from 'react'
import { ArrowDownUp, ArrowLeftRight } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToolState } from '@/lib/persist/useToolState'
import { useToolUsageTracker } from '@/lib/prefs'
import { ColorField, parseField } from '@/tools/color/ColorField'
import { Swatch } from '@/tools/color/Swatch'
import {
  checkContrast,
  formatRatio,
  suggestForeground,
  WCAG,
  type Suggestion,
  type WcagCheck,
} from '@fadeltd/devtools-core/color'

interface State {
  fg: string
  bg: string
}

// #777 on white is the classic near miss (4.48:1), so a first visit shows a
// failing verdict and a suggested fix rather than an all-green table.
const INITIAL: State = { fg: '#777777', bg: '#ffffff' }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel p-3">
      <h2 className="pb-2 text-[11px] font-semibold uppercase tracking-[0.02em] text-faint">{title}</h2>
      {children}
    </section>
  )
}

function Verdict({ check, pass }: { check: WcagCheck; pass: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Badge tone={pass ? 'add' : 'del'}>{pass ? 'Pass' : 'Fail'}</Badge>
      <span className="font-mono text-[11px] text-faint">≥ {WCAG[check]}:1</span>
    </div>
  )
}

export default function ContrastTool() {
  useToolUsageTracker('contrast')
  const { state, setState, reset } = useToolState<State>('contrast', INITIAL)
  const set = (key: keyof State, v: string) => setState((p) => ({ ...p, [key]: v }))

  const fg = useMemo(() => parseField(state.fg), [state.fg])
  const bg = useMemo(() => parseField(state.bg), [state.bg])

  const result = useMemo(() => {
    if (!fg.parse.ok || !bg.parse.ok) return null
    const fgColor = fg.parse.color
    const bgColor = bg.parse.color
    const report = checkContrast(fgColor, bgColor)
    // Suggest only what is missing: AA (and AAA, if reachable) when AA fails;
    // AAA alone when only AAA fails.
    const wanted: [string, number][] = []
    if (!report.pass.aaNormal) wanted.push(['AA', WCAG.aaNormal])
    if (!report.pass.aaaNormal) wanted.push(['AAA', WCAG.aaaNormal])
    const suggestions = wanted.map(([level, target]) => ({
      level,
      target,
      s: suggestForeground(fgColor, bgColor, target),
    }))
    return { report, suggestions }
  }, [fg, bg])

  return (
    <ToolFrame
      slug="contrast"
      actions={
        <Button variant="ghost" onClick={reset}>
          Reset
        </Button>
      }
    >
      <div className="h-full overflow-auto scroll-thin">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
          <section className="panel flex flex-col gap-2 p-3 md:flex-row md:items-start">
            <div className="min-w-0 flex-1">
              <ColorField label="Foreground (text)" value={state.fg} onChange={(v) => set('fg', v)} field={fg} />
            </div>
            <Button
              className="self-center md:mt-5 md:self-start"
              onClick={() => setState((p) => ({ fg: p.bg, bg: p.fg }))}
              title="Swap foreground and background"
            >
              <ArrowDownUp size={14} aria-hidden className="md:hidden" />
              <ArrowLeftRight size={14} aria-hidden className="hidden md:block" />
              <span>Swap</span>
            </Button>
            <div className="min-w-0 flex-1">
              <ColorField label="Background" value={state.bg} onChange={(v) => set('bg', v)} field={bg} />
            </div>
          </section>

          {result !== null && fg.info !== null && bg.info !== null && (
            <>
              <section className="panel flex flex-col gap-3 p-3 md:flex-row">
                <Preview fgCss={fg.info.css.hex} bgCss={bg.info.css.hex} />
                <div className="flex shrink-0 flex-col gap-3 md:w-64">
                  <div>
                    <div className="text-[12px] text-muted">Contrast ratio</div>
                    <div className="font-mono text-[40px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                      {formatRatio(result.report.ratio)}
                    </div>
                  </div>
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="text-muted">
                        <th className="py-1 pr-2 font-normal" />
                        <th className="py-1 pr-2 font-normal">Normal text</th>
                        <th className="py-1 font-normal">Large text</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      <tr>
                        <th className="py-1.5 pr-2 font-medium">AA</th>
                        <td className="py-1.5 pr-2">
                          <Verdict check="aaNormal" pass={result.report.pass.aaNormal} />
                        </td>
                        <td className="py-1.5">
                          <Verdict check="aaLarge" pass={result.report.pass.aaLarge} />
                        </td>
                      </tr>
                      <tr>
                        <th className="py-1.5 pr-2 font-medium">AAA</th>
                        <td className="py-1.5 pr-2">
                          <Verdict check="aaaNormal" pass={result.report.pass.aaaNormal} />
                        </td>
                        <td className="py-1.5">
                          <Verdict check="aaaLarge" pass={result.report.pass.aaaLarge} />
                        </td>
                      </tr>
                      <tr>
                        <th className="py-1.5 pr-2 font-medium">UI</th>
                        <td className="py-1.5" colSpan={2}>
                          <Verdict check="ui" pass={result.report.pass.ui} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-[11px] leading-snug text-faint">
                    Large text is at least 24px, or 18.66px bold. UI covers icons, borders and focus rings against
                    what is next to them.
                  </p>
                </div>
              </section>

              {result.report.notes.length > 0 && (
                <ul className="flex flex-col gap-1 px-1 text-[12px] leading-snug text-muted">
                  {result.report.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}

              {result.suggestions.length > 0 && (
                <Section title="Suggested foreground">
                  <div className="divide-y divide-border/60">
                    {result.suggestions.map(({ level, target, s }) => (
                      <SuggestionRow
                        key={level}
                        level={level}
                        target={target}
                        suggestion={s}
                        onApply={(hex) => set('fg', hex)}
                      />
                    ))}
                  </div>
                  <p className="pt-2 text-[11px] leading-snug text-faint">
                    Only the OKLCH lightness changes, so the hue stays the same; the closer of lighter and darker
                    wins.
                    {fg.info.alpha < 1 && ' The suggestion is opaque: the blended color, adjusted.'}
                  </p>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </ToolFrame>
  )
}

/**
 * Sample text in the user's colors. The background sits on white because a
 * translucent background is measured over white; on this app's dark canvas
 * the preview would show a different color from the one measured.
 */
function Preview({ fgCss, bgCss }: { fgCss: string; bgCss: string }) {
  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-[4px] border border-border bg-white">
      <div className="flex h-full flex-col gap-3 p-4" style={{ background: bgCss, color: fgCss }}>
        <p className="text-[24px] font-normal leading-tight">Large text, 24px</p>
        <p className="text-[16px] leading-normal">
          Normal text, 16px. The quick brown fox jumps over the lazy dog.
        </p>
        <p className="text-[13px] leading-normal">Small text, 13px, for captions and labels.</p>
        <div className="flex items-center gap-2">
          {/* currentColor, so the border is the foreground: what the UI 3:1 check measures. */}
          <span className="inline-flex min-h-7 items-center rounded-[4px] border border-current px-2 text-[12px] font-medium">
            Button
          </span>
          <span className="inline-block size-4 rounded-full border-2 border-current" aria-hidden />
        </div>
      </div>
    </div>
  )
}

function SuggestionRow({
  level,
  target,
  suggestion,
  onApply,
}: {
  level: string
  target: number
  suggestion: Suggestion | null
  onApply: (hex: string) => void
}) {
  if (suggestion === null) {
    return (
      <p className="py-1.5 text-[12px] text-muted">
        <span className="font-medium text-fg">{level}</span>: no color reaches {target}:1 on this background, not even
        black or white.
      </p>
    )
  }
  const direction = suggestion.deltaL > 0 ? 'lighter' : 'darker'
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <Swatch css={suggestion.hex} translucent={false} className="size-7 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[13px]">
          <span className="select-all">{suggestion.hex}</span>{' '}
          <span className="text-muted">{formatRatio(suggestion.ratio)}</span>
        </div>
        <div className="text-[11px] text-faint">
          {level} ({target}:1), {direction}
        </div>
      </div>
      <CopyButton value={suggestion.hex} />
      <Button onClick={() => onApply(suggestion.hex)}>Apply</Button>
    </div>
  )
}
