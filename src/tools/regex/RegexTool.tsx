import type { Remote } from 'comlink'
import { useDeferredValue, useEffect, useMemo, useRef, type ClipboardEvent, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button, Segmented } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import { cn } from '@/lib/util/cn'
import { useWorkerJob } from '@/lib/worker/useWorkerJob'
import { useNarrow } from '@/lib/util/narrow'
import {
  FLAG_INFO,
  MATCH_LIMIT,
  parseRegexLiteral,
  REGEX_FLAGS,
  type RegexFlag,
  type RegexMatch,
  type RegexMode,
  type RegexRun,
  type RegexRunInput,
} from '@fadeltd/devtools-core/regex'
import { hasLongLine } from '@fadeltd/devtools-core/text'
import type { RegexApi } from './regex.worker'

interface State {
  pattern: string
  flags: string
  text: string
  mode: RegexMode
  replacement: string
}

const INITIAL: State = { pattern: '', flags: 'g', text: '', mode: 'match', replacement: '' }

const MODES = [
  { value: 'match', label: 'Match', title: 'List every match and its groups' },
  { value: 'replace', label: 'Replace', title: 'Preview the text with each match replaced' },
] as const

/** A finished run, tagged with the input it was run on. */
interface Outcome {
  input: RegexRunInput
  run: RegexRun | null
}

// Module-level so useWorkerJob sees stable references.
function spawnRegex() {
  return new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' })
}

async function runInWorker(api: Remote<RegexApi>, input: RegexRunInput): Promise<Outcome> {
  // An empty pattern matches at every position; there is nothing to show.
  if (input.pattern === '') return { input, run: null }
  return { input, run: await api.run(input) }
}

/** Flags in the order the engine prints them; u and v exclude each other. */
function toggleFlag(flags: string, flag: RegexFlag): string {
  const set = new Set(flags)
  if (set.has(flag)) {
    set.delete(flag)
  } else {
    set.add(flag)
    if (flag === 'u') set.delete('v')
    if (flag === 'v') set.delete('u')
  }
  const known = REGEX_FLAGS.filter((f) => set.has(f)).join('')
  const unknown = [...set].filter((f) => !(REGEX_FLAGS as readonly string[]).includes(f)).join('')
  return known + unknown
}

/** One line for a table cell: breaks and tabs shown, long values cut. */
function cellText(text: string): string {
  const cut = text.length > 200 ? `${text.slice(0, 200)}…` : text
  return cut.replace(/\r\n|\r|\n/g, '⏎').replace(/\t/g, '→')
}

const ROW_NARROW = 44
const ROW_WIDE = 22

// One grid for header and rows, so the columns line up.
const GRID = 'grid grid-cols-[2.5rem_4rem_minmax(6rem,1fr)_minmax(8rem,1.5fr)] items-center gap-x-3'

export default function RegexTool() {
  useToolUsageTracker('regex')
  const { state, setState, reset, hydrating } = useToolState<State>('regex', INITIAL)

  const deferred = useDeferredValue(state)
  const input = useMemo<RegexRunInput>(
    () => ({
      pattern: deferred.pattern,
      flags: deferred.flags,
      text: deferred.text,
      mode: deferred.mode,
      // The replacement only matters in replace mode; ignoring it otherwise
      // keeps an edit to it from re-running the match.
      replacement: deferred.mode === 'replace' ? deferred.replacement : '',
    }),
    [deferred.pattern, deferred.flags, deferred.text, deferred.mode, deferred.replacement],
  )
  const job = useWorkerJob(spawnRegex, runInWorker, input)

  // The last finished run of the current mode; while a new one is running,
  // it stays on screen rather than blanking on every keystroke.
  const outcome = job.result?.input.mode === state.mode ? job.result : undefined
  const run = state.pattern === '' ? null : (outcome?.run ?? null)
  const failed = run !== null && !run.ok ? run : null
  const ok = run !== null && run.ok ? run : null
  const matches = ok?.match?.matches ?? []
  const replaced = ok?.replace ?? null
  const output = replaced?.output ?? ''

  const inputNoWrap = useMemo(() => hasLongLine(state.text), [state.text])
  const outputNoWrap = useMemo(() => hasLongLine(output), [output])

  const textRef = useRef<HTMLDivElement>(null)

  /** Selects a match in the text, where it can be seen in context. */
  function selectMatch(m: RegexMatch) {
    const ta = textRef.current?.querySelector('textarea')
    // The table may trail the text by a keystroke; its offsets would be stale.
    if (!ta || outcome === undefined || ta.value !== outcome.input.text) return
    ta.focus()
    ta.setSelectionRange(m.start, m.end)
  }

  function copyMatches() {
    void copyText(matches.map((m) => m.text).join('\n'))
  }

  /** A pasted `/pattern/flags` literal fills both fields. */
  function onPatternPaste(e: ClipboardEvent<HTMLInputElement>) {
    const literal = parseRegexLiteral(e.clipboardData.getData('text'))
    const field = e.currentTarget
    const replacesAll = field.selectionStart === 0 && field.selectionEnd === field.value.length
    if (literal === null || !replacesAll) return
    e.preventDefault()
    setState((p) => ({ ...p, pattern: literal.pattern, flags: literal.flags }))
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: state.mode === 'match' ? 'Copy matches' : 'Copy result',
      group: 'Regex Tester',
      scope: 'tool',
      whileTyping: true,
      run: () => {
        if (state.mode === 'match') copyMatches()
        else void copyText(output)
      },
    },
  ])

  let right: ReactNode
  if (state.mode === 'replace' && ok !== null) {
    right = (
      <CodeArea
        value={output}
        readOnly
        wrap={outputNoWrap ? 'off' : undefined}
        placeholder="The text with every match replaced appears here"
        aria-label="Result"
      />
    )
  } else {
    right = (
      <MatchTable
        matches={matches}
        groupNames={ok?.groupNames ?? []}
        onSelect={selectMatch}
        empty={
          hydrating
            ? 'Restoring your last input…'
            : state.pattern === ''
              ? 'Type a pattern to see its matches.'
              : failed !== null
                ? 'Fix the pattern to see its matches.'
                : state.text === ''
                  ? 'Paste text to test the pattern against.'
                  : ok === null
                    ? 'Matching…'
                    : 'No match.'
        }
      />
    )
  }

  const count = state.mode === 'match' ? matches.length : (replaced?.count ?? 0)
  const truncated = ok?.match?.truncated === true

  return (
    <ToolFrame
      slug="regex"
      actions={
        <>
          <Segmented
            value={state.mode}
            options={MODES}
            onChange={(mode) => setState((p) => ({ ...p, mode }))}
          />
          <FlagToggles flags={state.flags} onToggle={(f) => setState((p) => ({ ...p, flags: toggleFlag(p.flags, f) }))} />
          {state.mode === 'match' ? (
            <Button onClick={copyMatches} disabled={matches.length === 0} title="Copy every match, one per line">
              Copy matches
            </Button>
          ) : (
            <CopyButton value={output} />
          )}
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 space-y-1.5 border-b border-border px-3 py-1.5">
          <div className="flex items-center gap-2">
            <label htmlFor="regex-pattern" className="w-16 shrink-0 text-[12px] text-muted">
              Pattern
            </label>
            <span className="font-mono text-faint" aria-hidden>
              /
            </span>
            <input
              id="regex-pattern"
              className={cn(
                'min-h-11 min-w-0 flex-1 rounded-[4px] border bg-bg px-2 font-mono text-fg placeholder:text-faint md:min-h-7',
                failed === null ? 'border-border' : 'border-del/60',
              )}
              value={state.pattern}
              onChange={(e) => setState((p) => ({ ...p, pattern: e.target.value }))}
              onPaste={onPatternPaste}
              placeholder="(?<year>\d{4})-(?<month>\d{2}) — or paste /pattern/flags"
              aria-invalid={failed !== null}
              aria-describedby={failed === null ? undefined : 'regex-error'}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
            />
            <span className="shrink-0 font-mono text-faint" aria-label={`Flags: ${state.flags || 'none'}`}>
              /{state.flags}
            </span>
          </div>

          {state.mode === 'replace' && (
            <div className="flex items-center gap-2">
              <label htmlFor="regex-replacement" className="w-16 shrink-0 text-[12px] text-muted">
                Replace
              </label>
              <input
                id="regex-replacement"
                className="min-h-11 min-w-0 flex-1 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg placeholder:text-faint md:min-h-7"
                value={state.replacement}
                onChange={(e) => setState((p) => ({ ...p, replacement: e.target.value }))}
                placeholder="$<month>/$<year> — $1, $<name>, $& (whole match), $$ (a literal $)"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
              />
            </div>
          )}

          {failed !== null && (
            <p id="regex-error" className="flex items-start gap-1.5 text-[12px] text-del">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
              {failed.message}
            </p>
          )}
          {state.mode === 'replace' &&
            replaced?.issues.map((issue) => (
              <p key={issue.ref} className="flex items-start gap-1.5 text-[12px] text-warn">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                {issue.message}
              </p>
            ))}
        </div>

        <div className="min-h-0 flex-1">
          <TwoPane
            leftLabel="Text"
            rightLabel={state.mode === 'match' ? 'Matches' : 'Result'}
            left={
              <div ref={textRef} className="flex min-h-0 w-full flex-col">
                <CodeArea
                  value={state.text}
                  onChange={(e) => setState((p) => ({ ...p, text: e.target.value }))}
                  wrap={inputNoWrap ? 'off' : undefined}
                  placeholder="Paste the text to test against…"
                  aria-label="Text"
                />
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
                  {ok !== null && (
                    <span>
                      {truncated ? `${formatCount(MATCH_LIMIT)}+` : formatCount(count)}{' '}
                      {state.mode === 'match'
                        ? count === 1 && !truncated
                          ? 'match'
                          : 'matches'
                        : count === 1
                          ? 'replacement'
                          : 'replacements'}
                    </span>
                  )}
                  {ok !== null && ok.groupNames.length > 0 && (
                    <span>
                      {ok.groupNames.length} {ok.groupNames.length === 1 ? 'group' : 'groups'}
                    </span>
                  )}
                  {truncated && <Badge tone="warn">Showing the first {formatCount(MATCH_LIMIT)}</Badge>}
                  {ok !== null && state.mode === 'match' && !state.flags.includes('g') && state.text !== '' && (
                    <span title="Without g, JavaScript stops at the first match">first match only (no g)</span>
                  )}
                  {job.status === 'slow' && (
                    <>
                      <Badge tone="warn" title="The pattern is probably backtracking without end">
                        Still running after 2s
                      </Badge>
                      <Button variant="danger" onClick={job.cancel}>
                        Cancel
                      </Button>
                    </>
                  )}
                  {job.status === 'cancelled' && (
                    <Badge tone="del" title="Edit the pattern or the text to run again">
                      Cancelled — showing the last finished result
                    </Badge>
                  )}
                  {job.status === 'error' && <Badge tone="del">{job.error}</Badge>}
                </div>
              </div>
            }
            right={<div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">{right}</div>}
          />
        </div>
      </div>
    </ToolFrame>
  )
}

function FlagToggles({ flags, onToggle }: { flags: string; onToggle: (flag: RegexFlag) => void }) {
  return (
    <div
      role="group"
      aria-label="Flags"
      className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-[4px] border border-border bg-bg p-0.5 md:min-h-7"
    >
      {REGEX_FLAGS.map((f) => {
        const on = flags.includes(f)
        return (
          <button
            key={f}
            type="button"
            aria-pressed={on}
            title={`${f} · ${FLAG_INFO[f].name}: ${FLAG_INFO[f].description}`}
            onClick={() => onToggle(f)}
            className={cn(
              'min-h-10 min-w-8 rounded-[3px] font-mono text-[12px] transition-colors md:min-h-0 md:min-w-5 md:py-0.5',
              on ? 'bg-surface-2 text-fg' : 'text-faint hover:text-fg',
            )}
          >
            {f}
          </button>
        )
      })}
    </div>
  )
}

function MatchTable({
  matches,
  groupNames,
  onSelect,
  empty,
}: {
  matches: RegexMatch[]
  groupNames: Array<string | null>
  onSelect: (m: RegexMatch) => void
  empty: string
}) {
  const rowHeight = useNarrow() ? ROW_NARROW : ROW_WIDE
  const scrollRef = useRef<HTMLDivElement>(null)
  // The rule guards React Compiler memoisation, and this build does not run the
  // compiler. TanStack Virtual is the documented exception it flags.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 20,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  if (matches.length === 0) return <p className="p-3 text-[12px] text-faint">{empty}</p>

  return (
    <div
      ref={scrollRef}
      role="table"
      aria-label="Matches"
      aria-rowcount={matches.length + 1}
      className="min-h-0 flex-1 overflow-auto bg-bg font-mono text-[13px] md:text-[12px] scroll-thin"
    >
      <div className="min-w-100">
        <div
          role="row"
          className={cn(GRID, 'sticky top-0 z-10 border-b border-border bg-surface px-3 text-[11px] text-faint')}
          style={{ height: rowHeight }}
        >
          <span role="columnheader" className="text-right">
            #
          </span>
          <span role="columnheader">Ln:Col</span>
          <span role="columnheader">Match</span>
          <span role="columnheader">{groupNames.length > 0 ? 'Groups' : ''}</span>
        </div>
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const m = matches[item.index]!
            return (
              <button
                key={item.index}
                type="button"
                role="row"
                aria-rowindex={item.index + 2}
                onClick={() => onSelect(m)}
                title="Select in the text"
                className={cn(
                  GRID,
                  'absolute left-0 top-0 w-full cursor-default whitespace-nowrap px-3 text-left hover:bg-surface',
                )}
                style={{ height: rowHeight, transform: `translateY(${item.start}px)` }}
              >
                <span role="cell" className="text-right tabular-nums text-faint">
                  {formatCount(item.index + 1)}
                </span>
                <span role="cell" className="tabular-nums text-muted">
                  {m.line}:{m.column}
                </span>
                <span role="cell" className="truncate text-fg">
                  {m.text === '' ? <span className="text-faint">(empty)</span> : cellText(m.text)}
                </span>
                <span
                  role="cell"
                  className="truncate"
                  title={m.groups.map((g) => `${g.name ?? `$${g.number}`}=${g.text ?? '—'}`).join('\n')}
                >
                  {m.groups.map((g, i) => (
                    <span key={g.number} className="text-muted">
                      {i > 0 && ' '}
                      <span className="text-faint">{g.name ?? `$${g.number}`}=</span>
                      {g.text === null ? <span className="text-faint">—</span> : <span className="text-fg">{cellText(g.text)}</span>}
                    </span>
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
