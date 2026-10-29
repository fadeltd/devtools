import { useEffect, useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented, type SegmentOption } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import {
  describeDetected,
  formatInstant,
  isValidTimeZone,
  listTimeZones,
  parseTimestamp,
  relativeTime,
  systemTimeZone,
  type UnitChoice,
} from '@fadeltd/devtools-core/timestamp'

interface State {
  input: string
  unit: UnitChoice
  timeZone: string
}

const INITIAL: State = { input: '', unit: 'auto', timeZone: systemTimeZone() }

const UNITS: readonly SegmentOption<UnitChoice>[] = [
  { value: 'auto', label: 'Auto', title: 'Infer the unit from the number of digits' },
  { value: 's', label: 's', title: 'Seconds' },
  { value: 'ms', label: 'ms', title: 'Milliseconds' },
  { value: 'us', label: 'µs', title: 'Microseconds' },
  { value: 'ns', label: 'ns', title: 'Nanoseconds' },
]

/** "Now" written in whichever unit is forced, so the override still reads it correctly. */
function nowIn(unit: UnitChoice): string {
  const ms = Date.now()
  switch (unit) {
    case 's':
      return String(Math.floor(ms / 1000))
    case 'us':
      return `${ms}000`
    case 'ns':
      return `${ms}000000`
    default:
      return String(ms)
  }
}

/**
 * A clock that ticks once a second, but only while the tab is visible and
 * there is something to measure: a background tab re-rendering forever buys
 * nothing and costs battery.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
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
  }, [active])
  return now
}

function Row({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2 md:py-1.5">
      <div className="min-w-0 flex-1 md:flex md:items-baseline md:gap-3">
        <div className="text-[12px] text-muted md:w-42 md:shrink-0">{label}</div>
        <div className="min-w-0 break-all font-mono text-[13px] text-fg">
          {value ?? <span className="text-faint">{note ?? '—'}</span>}
        </div>
      </div>
      <CopyButton value={value ?? ''} />
    </div>
  )
}

export default function TimestampTool() {
  useToolUsageTracker('timestamp')
  const { state, setState, reset } = useToolState<State>('timestamp', INITIAL)

  const zones = useMemo(() => {
    const all = listTimeZones()
    // A persisted or system zone may be an alias (Asia/Calcutta) that the
    // canonical list leaves out; keep it selectable rather than silently swap it.
    return all.includes(state.timeZone) ? all : [state.timeZone, ...all]
  }, [state.timeZone])

  const zoneOk = isValidTimeZone(state.timeZone)

  const parsed = useMemo(
    () => parseTimestamp(state.input, { unit: state.unit, timeZone: zoneOk ? state.timeZone : 'UTC' }),
    [state.input, state.unit, state.timeZone, zoneOk],
  )

  const formatted = useMemo(
    () => (parsed.ok && zoneOk ? formatInstant(parsed.value.ns, { timeZone: state.timeZone }) : null),
    [parsed, state.timeZone, zoneOk],
  )

  const now = useNow(formatted !== null)
  const relative = parsed.ok && formatted !== null ? relativeTime(parsed.value.ns, now) : null

  const setNowInput = () => setState((p) => ({ ...p, input: nowIn(p.unit) }))

  useShortcuts([
    {
      combo: 'mod+enter',
      label: 'Set to now',
      group: 'Timestamp',
      scope: 'tool',
      whileTyping: true,
      run: setNowInput,
    },
  ])

  const field = 'min-h-11 w-full min-w-0 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg md:min-h-7'

  return (
    <ToolFrame
      slug="timestamp"
      actions={
        <Button variant="ghost" onClick={reset}>
          Clear
        </Button>
      }
    >
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="flex gap-1.5">
            <input
              className={field}
              value={state.input}
              onChange={(e) => setState((p) => ({ ...p, input: e.target.value }))}
              placeholder="1700000000, 1700000000000 or 2024-03-10T09:30:00Z"
              aria-label="Timestamp"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
            />
            <Button variant="primary" onClick={setNowInput} title="Set to now (⌘⏎)">
              <Clock size={14} aria-hidden />
              Now
            </Button>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Segmented
              value={state.unit}
              options={UNITS}
              onChange={(unit) => setState((p) => ({ ...p, unit }))}
              className="self-start"
            />
            <Select
              className="w-full md:w-auto md:min-w-60"
              value={state.timeZone}
              onChange={(e) => setState((p) => ({ ...p, timeZone: e.target.value }))}
              aria-label="Time zone"
              title="Time zone for the local forms"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            {!zoneOk ? (
              <span className="text-del" role="alert">
                Unknown time zone “{state.timeZone}”. Pick another.
              </span>
            ) : !parsed.ok ? (
              parsed.error.code === 'empty' ? (
                <span className="text-faint">
                  Paste a Unix timestamp in s, ms, µs or ns, or an ISO 8601 date-time.
                </span>
              ) : (
                <span className="text-del" role="alert">
                  {parsed.error.message}
                  {parsed.error.position !== undefined && (
                    <span className="text-muted"> (at character {parsed.error.position + 1})</span>
                  )}
                </span>
              )
            ) : (
              <>
                <Badge tone={parsed.value.detected.kind === 'loose' ? 'warn' : 'neutral'}>
                  {describeDetected(parsed.value.detected)}
                </Badge>
                {parsed.value.notes.map((note) => (
                  <span
                    key={note}
                    className={parsed.value.detected.kind === 'loose' ? 'text-warn' : 'text-muted'}
                  >
                    {note}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>

        {formatted !== null && (
          <div>
            <Row label="Unix seconds" value={formatted.epoch.s} />
            <Row label="Unix milliseconds" value={formatted.epoch.ms} />
            <Row label="Unix microseconds" value={formatted.epoch.us} />
            <Row label="Unix nanoseconds" value={formatted.epoch.ns} />
            <Row label="ISO 8601 (UTC)" value={formatted.isoUtc} />
            <Row label={`ISO 8601 (${state.timeZone})`} value={formatted.isoZoned} />
            <Row
              label="HTTP date (RFC 7231)"
              value={formatted.httpDate}
              note="Only defined for years 0000–9999"
            />
            <Row label={`Local (${state.timeZone})`} value={formatted.human} />
            <Row label="Relative" value={relative} />
            <Row label="Day of week" value={formatted.weekday} />
            <Row label="ISO week" value={formatted.isoWeekString} />
          </div>
        )}
      </div>
    </ToolFrame>
  )
}
