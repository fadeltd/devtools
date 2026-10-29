import { useDeferredValue, useMemo } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
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
  DEFAULT_ESCAPE_OPTIONS,
  ESCAPE_MODES,
  convertString,
  type EscapeDirection,
  type EscapeMode,
  type EscapeOptions,
  type JsQuote,
  type SqlDialect,
} from '@fadeltd/devtools-core/escape'

interface State extends EscapeOptions {
  input: string
  direction: EscapeDirection
  mode: EscapeMode
}

const INITIAL: State = { input: '', direction: 'escape', mode: 'json', ...DEFAULT_ESCAPE_OPTIONS }

const DIRECTIONS: readonly SegmentOption<EscapeDirection>[] = [
  { value: 'escape', label: 'Escape' },
  { value: 'unescape', label: 'Unescape' },
]

const QUOTES: readonly SegmentOption<JsQuote>[] = [
  { value: '"', label: '"', title: 'Double-quoted string' },
  { value: "'", label: "'", title: 'Single-quoted string' },
  { value: '`', label: '`', title: 'Template literal: also escapes ${' },
]

const PLACEHOLDERS: Record<EscapeMode, { escape: string; unescape: string }> = {
  json: { escape: 'Paste text to turn into a JSON string…', unescape: 'Paste a JSON string, with or without its quotes: "line\\nnext"' },
  js: { escape: 'Paste text to turn into a JavaScript string…', unescape: "Paste a JavaScript string literal or its body: 'it\\'s'" },
  sql: { escape: 'Paste text to put in a SQL string literal…', unescape: "Paste a SQL string literal or its body: 'O''Brien'" },
  shell: { escape: 'Paste one argument to quote for sh, bash or zsh…', unescape: "Paste one quoted shell word: 'it'\\''s'" },
  regex: { escape: 'Paste text to match literally in a regex…', unescape: 'Paste a literal pattern: 1\\.5\\+' },
  html: { escape: 'Paste text to put in HTML…', unescape: 'Paste text with entities: &lt;b&gt; &amp; &#169;' },
}

export default function EscapeTool() {
  useToolUsageTracker('escape')
  const { state, setState, reset } = useToolState<State>('escape', INITIAL)

  const deferred = useDeferredValue(state)
  const result = useMemo(
    () =>
      convertString(deferred.input, deferred.direction, deferred.mode, {
        wrap: deferred.wrap,
        asciiOnly: deferred.asciiOnly,
        quote: deferred.quote,
        sqlDialect: deferred.sqlDialect,
      }),
    [deferred],
  )
  const output = result.ok ? result.output : ''

  function swap() {
    setState((p) => ({
      ...p,
      direction: p.direction === 'escape' ? 'unescape' : 'escape',
      // Feed the output back in, so a swap checks the round trip and peels off
      // a second layer of escaping.
      input: result.ok && result.output !== '' ? result.output : p.input,
    }))
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'String Escaper',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(output),
    },
    {
      combo: 'mod+shift+s',
      label: 'Swap escape/unescape',
      group: 'String Escaper',
      scope: 'tool',
      whileTyping: true,
      run: swap,
    },
  ])

  const set = <K extends keyof State>(key: K, v: State[K]) => setState((p) => ({ ...p, [key]: v }))
  const info = ESCAPE_MODES.find((m) => m.mode === state.mode) ?? ESCAPE_MODES[0]!
  const escaping = state.direction === 'escape'

  return (
    <ToolFrame
      slug="escape"
      actions={
        <>
          <Segmented value={state.direction} options={DIRECTIONS} onChange={(v) => set('direction', v)} />
          <Select
            value={state.mode}
            onChange={(e) => set('mode', e.target.value as EscapeMode)}
            aria-label="Format"
          >
            {ESCAPE_MODES.map((m) => (
              <option key={m.mode} value={m.mode}>
                {m.label}
              </option>
            ))}
          </Select>
          {escaping && info.options.quote && (
            <Segmented value={state.quote} options={QUOTES} onChange={(v) => set('quote', v)} />
          )}
          {info.options.sqlDialect && (
            <Select
              value={state.sqlDialect}
              onChange={(e) => set('sqlDialect', e.target.value as SqlDialect)}
              aria-label="SQL dialect"
            >
              <option value="standard" title="Double the quote: PostgreSQL, SQLite, SQL Server, Oracle">
                Standard ('')
              </option>
              <option value="mysql" title="Backslash escapes: MySQL and MariaDB">
                MySQL (\')
              </option>
            </Select>
          )}
          {escaping && info.options.wrap && (
            <Toggle checked={state.wrap} onChange={(v) => set('wrap', v)}>
              Add quotes
            </Toggle>
          )}
          {escaping && info.options.asciiOnly && (
            <Toggle checked={state.asciiOnly} onChange={(v) => set('asciiOnly', v)}>
              ASCII only
            </Toggle>
          )}
          <Button onClick={swap} title="Swap direction (⌘⇧S)">
            <ArrowLeftRight size={14} aria-hidden />
            Swap
          </Button>
          <CopyButton value={output} />
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel={escaping ? 'Text' : 'Escaped'}
        rightLabel={escaping ? 'Escaped' : 'Text'}
        left={
          <CodeArea
            value={state.input}
            onChange={(e) => set('input', e.target.value)}
            placeholder={PLACEHOLDERS[state.mode][state.direction]}
          />
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            <CodeArea value={output} readOnly placeholder="Output appears here" />
            {deferred.input !== '' && (
              <div className="flex shrink-0 flex-col gap-1 border-t border-border px-3 py-1.5 text-[12px] leading-snug">
                {result.ok ? (
                  <>
                    {result.warnings.map((w) => (
                      <p key={w} className="text-warn">
                        {w}
                      </p>
                    ))}
                    <p className="font-mono text-[11px] text-faint">
                      {formatCount(deferred.input.length)} → {formatCount(result.output.length)} characters
                    </p>
                  </>
                ) : (
                  <p role="alert" className="text-del">
                    {result.error.message}
                  </p>
                )}
              </div>
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}
