import { useDeferredValue, useMemo } from 'react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Button, Segmented } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import {
  DEFAULT_SLUG_OPTIONS,
  safeFilenameLines,
  slugifyLines,
  type FilenameReplacement,
  type LineGroups,
  type SlugSeparator,
} from '@fadeltd/devtools-core/slug'

type Mode = 'slug' | 'filename'

interface State {
  mode: Mode
  input: string
  separator: SlugSeparator
  lowercase: boolean
  ascii: boolean
  ampersand: boolean
  maxLength: number
  replacement: FilenameReplacement
}

const INITIAL: State = {
  mode: 'slug',
  input: '',
  ...DEFAULT_SLUG_OPTIONS,
  replacement: '_',
}

const MODES = [
  { value: 'slug', label: 'Slug', title: 'URL slugs: lowercase words joined by a separator' },
  { value: 'filename', label: 'Filename', title: 'Names that are valid on Windows, macOS and Linux' },
] as const

const plural = (n: number, one: string, many = `${one}s`) =>
  `${formatCount(n)} ${n === 1 ? one : many}`

/** Enough line numbers to find the first few clashes; the rest would only wrap the note. */
const MAX_LISTED_LINES = 12

/** "4 names collide on Windows/macOS: lines 3, 7; 4, 9", one "; " between groups. */
function collisionNote(groups: LineGroups, what: string): string {
  const total = groups.reduce((n, g) => n + g.length, 0)
  const listed: string[] = []
  let budget = MAX_LISTED_LINES
  for (const group of groups) {
    if (budget <= 0) break
    const take = group.slice(0, budget)
    budget -= take.length
    // Plain digits: "1,234" would read as two line numbers in a comma list.
    listed.push(take.join(', ') + (take.length < group.length ? ', …' : ''))
  }
  const more = listed.length < groups.length ? '; …' : ''
  return `${formatCount(total)} names ${what}: lines ${listed.join('; ')}${more}`
}

export default function SlugTool() {
  useToolUsageTracker('slug')
  const { state, setState, reset } = useToolState<State>('slug', INITIAL)
  const set = <K extends keyof State>(key: K, value: State[K]) =>
    setState((p) => ({ ...p, [key]: value }))

  const deferred = useDeferredValue(state)
  const { output, notes, warnings } = useMemo(() => {
    const none: string[] = []
    if (deferred.input === '') return { output: '', notes: none, warnings: none }

    if (deferred.mode === 'slug') {
      const r = slugifyLines(deferred.input, {
        separator: deferred.separator,
        lowercase: deferred.lowercase,
        ascii: deferred.ascii,
        ampersand: deferred.ampersand,
        maxLength: deferred.maxLength,
      })
      const slugNotes = [plural(r.lines, 'line')]
      if (r.empty > 0) slugNotes.push(`${plural(r.empty, 'line')} had nothing to slug`)
      return { output: r.output, notes: slugNotes, warnings: none }
    }

    const r = safeFilenameLines(deferred.input, { replacement: deferred.replacement })
    const s = r.summary
    const fileNotes = [
      s.changed === 0
        ? `${plural(s.lines, 'line')}, all already safe`
        : `${plural(s.changed, 'line')} changed`,
    ]
    if (s.removedChars > 0) fileNotes.push(`${plural(s.removedChars, 'character')} replaced`)
    if (s.reserved > 0) fileNotes.push(plural(s.reserved, 'reserved name'))
    if (s.trimmed > 0) fileNotes.push(`${formatCount(s.trimmed)} trimmed`)
    if (s.truncated > 0) fileNotes.push(`${formatCount(s.truncated)} cut to 255 bytes`)
    if (s.fallback > 0) fileNotes.push(`${formatCount(s.fallback)} empty, named untitled`)
    const fileWarnings: string[] = []
    const { exact, caseOnly } = r.collisions
    if (exact.length > 0) fileWarnings.push(collisionNote(exact, 'repeat exactly'))
    if (caseOnly.length > 0) fileWarnings.push(collisionNote(caseOnly, 'collide on Windows/macOS'))
    return { output: r.output, notes: fileNotes, warnings: fileWarnings }
  }, [deferred])

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'Slug Generator',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
  ])

  return (
    <ToolFrame
      slug="slug"
      actions={
        <>
          <Segmented value={state.mode} options={MODES} onChange={(v) => set('mode', v)} />
          {state.mode === 'slug' ? (
            <>
              <Select
                value={state.separator}
                onChange={(e) => set('separator', e.target.value as SlugSeparator)}
                title="Separator"
                aria-label="Separator"
              >
                <option value="-">a-b</option>
                <option value="_">a_b</option>
                <option value=".">a.b</option>
              </Select>
              <Toggle checked={state.lowercase} onChange={(v) => set('lowercase', v)}>
                Lowercase
              </Toggle>
              <Toggle checked={state.ascii} onChange={(v) => set('ascii', v)}>
                ASCII only
              </Toggle>
              <Toggle checked={state.ampersand} onChange={(v) => set('ampersand', v)}>
                &amp; → and
              </Toggle>
              <label className="flex min-h-11 shrink-0 items-center gap-1.5 md:min-h-7">
                <span className="whitespace-nowrap text-[12px] text-muted">Max length</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="min-h-11 w-16 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg placeholder:text-faint md:min-h-7"
                  value={state.maxLength === 0 ? '' : state.maxLength}
                  placeholder="none"
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value))
                    set('maxLength', Number.isFinite(n) && n > 0 ? n : 0)
                  }}
                />
              </label>
            </>
          ) : (
            <Select
              value={state.replacement}
              onChange={(e) => set('replacement', e.target.value as FilenameReplacement)}
              title="What a forbidden character becomes"
              aria-label="Replacement"
            >
              <option value="_">Replace with _</option>
              <option value="-">Replace with -</option>
              <option value="">Remove</option>
            </Select>
          )}
          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel="Text"
        rightLabel={state.mode === 'slug' ? 'Slugs' : 'Filenames'}
        left={
          <CodeArea
            value={state.input}
            onChange={(e) => set('input', e.target.value)}
            placeholder={
              state.mode === 'slug'
                ? 'One title per line — Crème Brûlée & Co, fooBar…'
                : 'One filename per line — report: Q3?.pdf, CON.txt…'
            }
          />
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            <CodeArea
              value={output}
              readOnly
              placeholder={state.mode === 'slug' ? 'Slugs appear here' : 'Safe filenames appear here'}
            />
            {notes.length > 0 && (
              <div className="shrink-0 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
                {notes.join(' · ')}
                {warnings.map((w) => (
                  <p key={w} className="text-warn">
                    {w}
                  </p>
                ))}
              </div>
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
