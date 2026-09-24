import { useDeferredValue, useMemo } from 'react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatBytes, formatCount } from '@/lib/util/bytes'
import { analyzeText, formatDuration } from './core/stats'
import { wordFrequencies } from './core/frequency'

interface State {
  text: string
  phraseSize: 1 | 2 | 3
  ignoreStopWords: boolean
  minLength: number
}

const INITIAL: State = { text: '', phraseSize: 1, ignoreStopWords: false, minLength: 1 }

function Row({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[12px] text-muted" title={hint}>
        {label}
      </span>
      <span className="font-mono text-[13px] tabular-nums">{value}</span>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-3">
      <h2 className="pb-1 text-[11px] font-semibold uppercase tracking-[0.02em] text-faint">
        {title}
      </h2>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  )
}

export default function TextStatsTool() {
  useToolUsageTracker('text-stats')
  const { state, setState, reset } = useToolState<State>('text-stats', INITIAL)

  const deferred = useDeferredValue(state)
  const stats = useMemo(() => analyzeText(deferred.text), [deferred.text])

  const phrases = useMemo(
    () =>
      wordFrequencies(deferred.text, {
        size: deferred.phraseSize,
        caseSensitive: false,
        ignoreStopWords: deferred.ignoreStopWords,
        minLength: deferred.minLength,
        limit: 25,
      }),
    [deferred.text, deferred.phraseSize, deferred.ignoreStopWords, deferred.minLength],
  )

  const summary = useMemo(() => {
    const c = stats.characters
    const w = stats.words
    const s = stats.structure
    return [
      `Characters: ${c.graphemes}`,
      `Characters (no spaces): ${c.graphemesNoWhitespace}`,
      `Letters: ${stats.classes.letters}`,
      `Digits: ${stats.classes.digits}`,
      `Words: ${w.words}`,
      `Unique words: ${w.uniqueWords}`,
      `Sentences: ${s.sentences}`,
      `Paragraphs: ${s.paragraphs}`,
      `Lines: ${s.lines}`,
      `Bytes (UTF-8): ${c.bytes}`,
      `Reading time: ${formatDuration(stats.time.readingSeconds)}`,
    ].join('\n')
  }, [stats])

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy statistics',
      group: 'Text statistics',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(summary),
    },
  ])

  const maxCount = phrases[0]?.count ?? 1

  return (
    <ToolFrame
      slug="text-stats"
      actions={
        <>
          <Select
            value={String(state.phraseSize)}
            onChange={(e) =>
              setState((p) => ({ ...p, phraseSize: Number(e.target.value) as 1 | 2 | 3 }))
            }
            title="Phrase length for the frequency table"
          >
            <option value="1">Single words</option>
            <option value="2">Two-word phrases</option>
            <option value="3">Three-word phrases</option>
          </Select>
          <Toggle
            checked={state.ignoreStopWords}
            onChange={(v) => setState((p) => ({ ...p, ignoreStopWords: v }))}
          >
            Ignore common words
          </Toggle>
          <Select
            value={String(state.minLength)}
            onChange={(e) => setState((p) => ({ ...p, minLength: Number(e.target.value) }))}
            title="Minimum word length"
          >
            <option value="1">Any length</option>
            <option value="3">3+ characters</option>
            <option value="4">4+ characters</option>
            <option value="5">5+ characters</option>
          </Select>
          <CopyButton value={summary} label="Copy stats" />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        rightLabel="Statistics"
        left={
          <CodeArea
            value={state.text}
            onChange={(e) => setState((p) => ({ ...p, text: e.target.value }))}
            placeholder="Paste or type text to analyse…"
          />
        }
        right={
          <div className="min-h-0 w-full overflow-y-auto border-t border-border p-3 scroll-thin md:border-l md:border-t-0">
            <div className="grid gap-3 lg:grid-cols-2">
              <Group title="Characters">
                <Row
                  label="Characters"
                  value={formatCount(stats.characters.graphemes)}
                  hint="Grapheme clusters — an emoji family counts as one, like a human would count."
                />
                <Row
                  label="Excluding whitespace"
                  value={formatCount(stats.characters.graphemesNoWhitespace)}
                />
                <Row label="Letters" value={formatCount(stats.classes.letters)} />
                <Row label="Digits" value={formatCount(stats.classes.digits)} />
                <Row label="Punctuation" value={formatCount(stats.classes.punctuation)} />
                <Row label="Symbols" value={formatCount(stats.classes.symbols)} />
                <Row label="Whitespace" value={formatCount(stats.classes.whitespace)} />
              </Group>

              <Group title="Words">
                <Row label="Words" value={formatCount(stats.words.words)} />
                <Row label="Unique words" value={formatCount(stats.words.uniqueWords)} />
                <Row
                  label="Average length"
                  value={
                    stats.words.words === 0 ? '—' : stats.words.averageWordLength.toFixed(1)
                  }
                />
                <Row
                  label="Longest word"
                  value={stats.words.longestWord === '' ? '—' : stats.words.longestWord}
                />
              </Group>

              <Group title="Structure">
                <Row label="Lines" value={formatCount(stats.structure.lines)} />
                <Row label="Non-blank lines" value={formatCount(stats.structure.nonBlankLines)} />
                <Row
                  label="Sentences"
                  value={formatCount(stats.structure.sentences)}
                  hint="Approximate. Common abbreviations and initials are not treated as sentence ends."
                />
                <Row label="Paragraphs" value={formatCount(stats.structure.paragraphs)} />
                <Row
                  label="Longest line"
                  value={`${formatCount(stats.structure.longestLineChars)} chars`}
                />
              </Group>

              <Group title="Size and time">
                <Row
                  label="UTF-8 size"
                  value={formatBytes(stats.characters.bytes)}
                  hint="What a byte-limited database column or API payload actually counts."
                />
                <Row
                  label="Code points"
                  value={formatCount(stats.characters.codePoints)}
                  hint="What most text-message and API character limits count."
                />
                <Row
                  label="UTF-16 units"
                  value={formatCount(stats.characters.utf16Units)}
                  hint="JavaScript's String.length."
                />
                <Row
                  label="Reading time"
                  value={formatDuration(stats.time.readingSeconds)}
                  hint="Silent reading at 238 words per minute."
                />
                <Row
                  label="Speaking time"
                  value={formatDuration(stats.time.speakingSeconds)}
                  hint="Reading aloud at 150 words per minute."
                />
              </Group>
            </div>

            <section className="panel mt-3 p-3">
              <h2 className="pb-2 text-[11px] font-semibold uppercase tracking-[0.02em] text-faint">
                Most frequent {state.phraseSize === 1 ? 'words' : `${state.phraseSize}-word phrases`}
              </h2>
              {phrases.length === 0 ? (
                <p className="text-[12px] text-faint">
                  {stats.empty ? 'Nothing to count yet.' : 'No words match the current filters.'}
                </p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {phrases.map((p) => (
                    <li key={p.phrase} className="flex items-center gap-2">
                      <span
                        className="w-28 shrink-0 truncate font-mono text-[12px] md:w-36"
                        title={p.phrase}
                      >
                        {p.phrase}
                      </span>
                      {/* The bar sits in its own track so a full-width bar cannot
                          push the numbers -- which are the actual data -- off the row. */}
                      <span className="h-1.5 min-w-0 flex-1 rounded-[2px] bg-surface-2" aria-hidden>
                        <span
                          className="block h-full rounded-[2px] bg-accent/50"
                          style={{ width: `${(p.count / maxCount) * 100}%` }}
                        />
                      </span>
                      <span className="w-24 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted">
                        {formatCount(p.count)} · {(p.density * 100).toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        }
      />
    </ToolFrame>
  )
}
