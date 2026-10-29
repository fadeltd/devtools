import { useDeferredValue, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { Button, Segmented, type SegmentOption } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import {
  LOREM_LIMITS,
  generateLorem,
  type LoremFormat,
  type LoremOptions,
  type LoremUnit,
} from '@fadeltd/devtools-core/lorem'
import { mulberry32 } from '@fadeltd/devtools-core/random'

// Only the options are stored. The text is regenerated on every visit, so
// nothing large ever goes to localStorage.
const INITIAL: LoremOptions = { count: 3, unit: 'paragraphs', format: 'text', startWithLorem: true }

const UNITS: readonly SegmentOption<LoremUnit>[] = [
  { value: 'words', label: 'Words' },
  { value: 'sentences', label: 'Sentences' },
  { value: 'paragraphs', label: 'Paragraphs' },
]

const FORMATS: Record<LoremFormat, string> = {
  text: 'Plain text',
  html: 'HTML <p>',
  markdown: 'Markdown',
}

function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!
}

export default function LoremTool() {
  useToolUsageTracker('lorem')
  const { state, setState, reset } = useToolState<LoremOptions>('lorem', INITIAL)
  // A crypto-random seed, replaced by Regenerate. Changing an option keeps it,
  // so switching the format re-renders the same words rather than new ones.
  const [seed, setSeed] = useState(newSeed)

  const deferred = useDeferredValue(state)
  const result = useMemo(() => generateLorem(deferred, mulberry32(seed)), [deferred, seed])

  const regenerate = () => setSeed(newSeed())

  useShortcuts([
    {
      combo: 'mod+enter',
      label: 'Regenerate',
      group: 'Lorem Ipsum',
      scope: 'tool',
      whileTyping: true,
      run: regenerate,
    },
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'Lorem Ipsum',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(result.output),
    },
  ])

  const set = <K extends keyof LoremOptions>(key: K, v: LoremOptions[K]) =>
    setState((p) => ({ ...p, [key]: v }))
  const limit = LOREM_LIMITS[state.unit]

  return (
    <ToolFrame
      slug="lorem"
      actions={
        <>
          <Button variant="primary" onClick={regenerate} title="Regenerate (⌘⏎)">
            <RefreshCw size={14} aria-hidden />
            Regenerate
          </Button>
          <CopyButton value={result.output} />
          <Button variant="ghost" onClick={reset}>
            Reset
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2">
          <label className="flex items-center gap-1.5">
            <span className="text-[12px] text-muted">Count</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={limit}
              className="min-h-11 w-24 rounded-[4px] border border-border bg-bg px-2 font-mono text-fg md:min-h-7"
              // An emptied field shows empty rather than snapping to 0 mid-edit.
              value={state.count > 0 ? state.count : ''}
              onChange={(e) => set('count', e.target.valueAsNumber)}
            />
          </label>
          <Segmented value={state.unit} options={UNITS} onChange={(v) => set('unit', v)} />
          <Select
            value={state.format}
            onChange={(e) => set('format', e.target.value as LoremFormat)}
            aria-label="Output format"
          >
            {(Object.keys(FORMATS) as LoremFormat[]).map((f) => (
              <option key={f} value={f}>
                {FORMATS[f]}
              </option>
            ))}
          </Select>
          <Toggle checked={state.startWithLorem} onChange={(v) => set('startWithLorem', v)}>
            Start with “Lorem ipsum…”
          </Toggle>
        </div>

        <div className="min-h-0 flex-1">
          <CodeArea value={result.output} readOnly placeholder="Choose how much text to generate" />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 text-[12px] leading-snug">
          {result.capped && (
            <p className="text-warn">
              Capped at {formatCount(limit)} {state.unit} to keep the page responsive.
            </p>
          )}
          <p className="font-mono text-[11px] text-faint">
            {formatCount(result.paragraphs)} {result.paragraphs === 1 ? 'paragraph' : 'paragraphs'} ·{' '}
            {formatCount(result.sentences)} {result.sentences === 1 ? 'sentence' : 'sentences'} ·{' '}
            {formatCount(result.words)} {result.words === 1 ? 'word' : 'words'} ·{' '}
            {formatCount(result.output.length)} characters
          </p>
        </div>
      </div>
    </ToolFrame>
  )
}
