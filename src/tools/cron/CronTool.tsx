import { useEffect, useMemo, useState } from 'react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useToolUsageTracker } from '@/lib/prefs'
import {
  describeCron,
  fieldLabel,
  nextRuns,
  parseCron,
  type CronError,
  type CronRun,
} from '@fadeltd/devtools-core/cron'
import { isValidTimeZone, listTimeZones, relativeTime, systemTimeZone } from '@fadeltd/devtools-core/timestamp'

interface State {
  expression: string
  timeZone: string
  hour24: boolean
}

const INITIAL: State = { expression: '*/15 9-17 * * MON-FRI', timeZone: systemTimeZone(), hour24: false }

const RUN_COUNT = 10

/** Each one shows off a rule worth knowing, not just a shape. */
const EXAMPLES: readonly { expression: string; label: string }[] = [
  { expression: '*/15 * * * *', label: 'every 15 min' },
  { expression: '0 9 * * MON-FRI', label: 'weekdays at 9' },
  { expression: '0 0 1 * *', label: 'monthly' },
  { expression: '30 2 * * *', label: 'in the DST gap' },
  { expression: '0 0 13 * FRI', label: 'the 13th or a Friday' },
  { expression: '@hourly', label: 'macro' },
  { expression: '*/10 * * * * *', label: 'with seconds' },
  { expression: '0 0 29 2 *', label: 'leap day' },
]

/**
 * A clock for the relative times and for rolling the list forward as runs
 * pass. Ticks once a second, and only while the tab is visible.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      if (id !== undefined) clearInterval(id)
      id = undefined
    }
    const sync = () => {
      if (document.visibilityState !== 'visible') return stop()
      setNow(Date.now())
      if (id === undefined) id = setInterval(() => setNow(Date.now()), 1000)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  return now
}

function ErrorLine({ input, error }: { input: string; error: CronError }) {
  // A caret under the offending character. Tabs are shown as spaces so the
  // caret's offset (in UTF-16 units) still lines up in a monospace font.
  const shown = input.replaceAll('\t', ' ')
  const caret = error.code !== 'empty' && error.position <= shown.length
  return (
    <div role="alert" className="flex flex-col gap-1 text-[12px]">
      <span className="text-del">
        {error.message}
        <span className="text-muted">
          {' '}
          ({error.field !== null ? `${fieldLabel(error.field)}, ` : ''}character {error.position + 1})
        </span>
      </span>
      {caret && (
        <div className="overflow-x-auto font-mono text-[13px] leading-4.5 whitespace-pre scroll-thin" aria-hidden>
          <div className="text-fg">{shown}</div>
          <div className="text-del">{`${' '.repeat(error.position)}^`}</div>
        </div>
      )}
    </div>
  )
}

function RunRow({ run, now }: { run: CronRun; now: number }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2 md:py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-col md:flex-row md:items-baseline md:gap-3">
          <span className="break-all font-mono text-[13px] text-fg">{run.iso}</span>
          <span className="text-[12px] text-muted">
            {run.weekday} · {relativeTime(BigInt(run.ms) * 1_000_000n, now)}
          </span>
        </div>
        {run.note !== null && <div className="mt-0.5 text-[12px] text-warn">{run.note}</div>}
      </div>
      <CopyButton value={run.iso} />
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="border-b border-border px-3 py-1.5 text-[11px] font-medium tracking-[0.04em] text-faint uppercase">
      {children}
    </h2>
  )
}

export default function CronTool() {
  useToolUsageTracker('cron')
  const { state, setState, reset } = useToolState<State>('cron', INITIAL)
  const now = useNow()

  const zones = useMemo(() => {
    const all = listTimeZones()
    // A persisted or system zone may be an alias the canonical list leaves out;
    // keep it selectable rather than silently swap it.
    return all.includes(state.timeZone) ? all : [state.timeZone, ...all]
  }, [state.timeZone])
  const zoneOk = isValidTimeZone(state.timeZone)

  const parsed = useMemo(() => parseCron(state.expression), [state.expression])
  const schedule = parsed.ok ? parsed.value : null

  const description = useMemo(
    () => (schedule === null ? null : describeCron(schedule, { use24HourTimeFormat: state.hour24 })),
    [schedule, state.hour24],
  )

  // Recomputed once a second so the list rolls forward as runs pass; it is a
  // calendar walk plus a few Intl calls per run, well under a millisecond.
  const second = Math.floor(now / 1000)
  const upcoming = useMemo(
    () =>
      schedule !== null && schedule.kind === 'schedule' && zoneOk
        ? nextRuns(schedule, { now: second * 1000, timeZone: state.timeZone, count: RUN_COUNT })
        : null,
    [schedule, second, state.timeZone, zoneOk],
  )

  const field = 'min-h-11 w-full min-w-0 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg md:min-h-7'

  return (
    <ToolFrame
      slug="cron"
      actions={
        <Button variant="ghost" onClick={reset}>
          Reset
        </Button>
      }
    >
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <input
            className={field}
            value={state.expression}
            onChange={(e) => setState((p) => ({ ...p, expression: e.target.value }))}
            placeholder="*/15 * * * *"
            aria-label="Cron expression"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
          />

          <div className="flex flex-wrap gap-1.5" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <Button
                key={ex.expression}
                onClick={() => setState((p) => ({ ...p, expression: ex.expression }))}
                aria-pressed={state.expression.trim() === ex.expression}
              >
                <span className="font-mono">{ex.expression}</span>
                <span className="font-normal text-muted">{ex.label}</span>
              </Button>
            ))}
          </div>

          {!parsed.ok && (
            parsed.error.code === 'empty' ? (
              <span className="text-[12px] text-faint">
                Five fields (minute hour day-of-month month day-of-week), six with seconds first, or a macro such as
                @daily.
              </span>
            ) : (
              <ErrorLine input={state.expression} error={parsed.error} />
            )
          )}
        </div>

        {schedule !== null && (
          <div className="flex flex-col gap-2 border-b border-border p-3">
            {description !== null &&
              (description.ok ? (
                <p className="text-[18px] leading-6 font-semibold tracking-[-0.01em] text-fg md:text-[20px] md:leading-7">
                  {description.text}
                </p>
              ) : (
                <p role="alert" className="text-[12px] text-del">
                  {description.error.message}
                </p>
              ))}
            {schedule.macro !== null && schedule.kind === 'schedule' && (
              <p className="font-mono text-[12px] text-muted">
                {schedule.macro} = {schedule.expression}
              </p>
            )}
            {schedule.kind === 'schedule' &&
              schedule.notes.map((note) => (
                <p key={note} className="text-[12px] text-warn">
                  {note}
                </p>
              ))}
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
              <Select
                className="w-full md:w-auto md:min-w-60"
                value={state.timeZone}
                onChange={(e) => setState((p) => ({ ...p, timeZone: e.target.value }))}
                aria-label="Time zone"
                title="Time zone the schedule runs in"
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll('_', ' ')}
                  </option>
                ))}
              </Select>
              <Toggle checked={state.hour24} onChange={(hour24) => setState((p) => ({ ...p, hour24 }))}>
                24-hour clock
              </Toggle>
            </div>
            {!zoneOk && (
              <span role="alert" className="text-[12px] text-del">
                Unknown time zone “{state.timeZone}”. Pick another.
              </span>
            )}
          </div>
        )}

        {schedule !== null && schedule.kind === 'reboot' && (
          <p className="p-3 text-[12px] text-muted">
            @reboot has no schedule: cron runs it once when the daemon starts, so there are no upcoming times to list.
          </p>
        )}

        {schedule !== null && schedule.kind === 'schedule' && (
          <div className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section className="border-b border-border lg:border-r">
              <SectionTitle>Fields</SectionTitle>
              <table className="w-full border-collapse text-[12px] leading-4.5">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-faint">
                    <th className="px-3 py-1 font-medium">Field</th>
                    <th className="px-3 py-1 font-medium">Value</th>
                    <th className="px-3 py-1 font-medium">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.fields.map((f) => (
                    <tr key={f.name} className="border-b border-border align-top last:border-b-0">
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted">{f.label}</td>
                      <td className="px-3 py-1.5 font-mono break-all text-fg">{f.text}</td>
                      <td className="px-3 py-1.5 text-fg">{f.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="border-b border-border">
              <SectionTitle>{`Next ${RUN_COUNT} runs`}</SectionTitle>
              {upcoming !== null && upcoming.ok && (
                <>
                  {upcoming.runs.map((run) => (
                    <RunRow key={run.ms} run={run} now={now} />
                  ))}
                  <div className="flex flex-col gap-1 px-3 py-2 text-[12px]">
                    {upcoming.reason !== null && (
                      <span className={upcoming.status === 'never' ? 'text-del' : 'text-warn'}>
                        {upcoming.status === 'never' && (
                          <Badge tone="del" className="mr-1.5">
                            never fires
                          </Badge>
                        )}
                        {upcoming.reason}
                      </span>
                    )}
                    {upcoming.notes.map((note) => (
                      <span key={note} className="text-warn">
                        {note}
                      </span>
                    ))}
                    <span className="text-muted">
                      Times are wall-clock in {state.timeZone}. Across daylight saving, this follows Vixie cron: a
                      fixed-time run that falls in a spring-forward gap fires at the first instant after it, and one in a
                      fall-back overlap fires once, at the first occurrence. Schedules with * in the minute or hour field
                      skip the gap and run through both passes of the repeated hour.
                    </span>
                  </div>
                </>
              )}
              {upcoming !== null && !upcoming.ok && (
                <p role="alert" className="px-3 py-2 text-[12px] text-del">
                  {upcoming.error.message}
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </ToolFrame>
  )
}
