import { useDeferredValue, useMemo } from 'react'
import { CircleX, TriangleAlert } from 'lucide-react'
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
import { formatCount } from '@/lib/util/bytes'
import {
  convertEnv,
  issueId,
  maskEntries,
  serializeEnv,
  type EnvInputFormat,
  type EnvIssue,
  type EnvOutputFormat,
} from '@fadeltd/devtools-core/env'

interface State {
  input: string
  from: EnvInputFormat | 'auto'
  to: EnvOutputFormat
  flatten: boolean
  mask: boolean
}

// The registry declares store 'none', so useToolState keeps this in memory
// only: a .env file is a list of secrets.
const INITIAL: State = { input: '', from: 'auto', to: 'json', flatten: false, mask: false }

const INPUTS: { value: State['from']; label: string }[] = [
  { value: 'auto', label: 'Input: auto' },
  { value: 'dotenv', label: 'Input: .env' },
  { value: 'json', label: 'Input: JSON' },
  { value: 'shell', label: 'Input: shell export' },
]

const OUTPUTS: { value: EnvOutputFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'dotenv', label: '.env' },
  { value: 'shell', label: 'Shell export' },
  { value: 'docker', label: 'docker --env-file' },
]

const FORMAT_NAME: Record<EnvInputFormat, string> = { dotenv: '.env', json: 'JSON', shell: 'shell export' }

const EXAMPLE = `# Every value here is made up.
export APP_NAME=devtools
PORT = 8080
DATABASE_URL="postgres://app:s3cret pass@localhost:5432/app" # inline comment
GREETING='Hello, "world"'
PRIVATE_KEY="-----BEGIN KEY-----
bm90IGEgcmVhbCBrZXk=
-----END KEY-----"
EMPTY=
feature.flag-x=on
PORT=9090
`

/** Long issue lists scroll inside their box; the output keeps the space. */
const MAX_ISSUES = 200

export default function EnvTool() {
  useToolUsageTracker('env')
  const { state, setState, reset } = useToolState<State>('env', INITIAL)

  const input = useDeferredValue(state.input)
  const result = useMemo(
    () => convertEnv(input, { from: state.from, to: state.to, flatten: state.flatten }),
    [input, state.from, state.to, state.flatten],
  )

  // The preview is masked; Copy (and the shortcut) still take result.output.
  const shown = useMemo(
    () => (state.mask ? serializeEnv(maskEntries(result.entries), state.to).text : result.output),
    [state.mask, state.to, result],
  )

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: '.env Converter',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(result.output),
    },
  ])

  const set = <K extends keyof State>(key: K, value: State[K]) => setState((p) => ({ ...p, [key]: value }))
  const errorCount = result.issues.filter((i) => i.severity === 'error').length
  const warningCount = result.issues.length - errorCount

  return (
    <ToolFrame
      slug="env"
      actions={
        <>
          <Select
            value={state.from}
            onChange={(e) => set('from', e.target.value as State['from'])}
            aria-label="Input format"
          >
            {INPUTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select
            value={state.to}
            onChange={(e) => set('to', e.target.value as EnvOutputFormat)}
            aria-label="Output format"
          >
            {OUTPUTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {result.from === 'json' && (
            <Toggle checked={state.flatten} onChange={(v) => set('flatten', v)}>
              Flatten nested with __
            </Toggle>
          )}
          <Toggle checked={state.mask} onChange={(v) => set('mask', v)}>
            Mask values
          </Toggle>
          <CopyButton value={result.output} />
          <Button onClick={() => setState((p) => ({ ...p, input: EXAMPLE, from: 'auto' }))}>Example</Button>
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel="Input"
        rightLabel="Output"
        left={
          <CodeArea
            value={state.input}
            onChange={(e) => set('input', e.target.value)}
            placeholder={'Paste a .env file, shell export lines or a JSON object\n\nAPI_URL=https://api.example.com\nexport TOKEN="…"'}
            aria-label="Input"
          />
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            <CodeArea
              value={shown}
              readOnly
              placeholder="The converted output appears here. Nothing you paste is saved or sent anywhere."
              aria-label="Output"
            />
            {result.issues.length > 0 && <Issues issues={result.issues} />}
            {state.input.trim() !== '' && (
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
                <span>
                  {formatCount(result.entries.length)} {result.entries.length === 1 ? 'variable' : 'variables'}
                </span>
                <span>
                  read as {FORMAT_NAME[result.from]}
                  {state.from === 'auto' ? ' (detected)' : ''}
                </span>
                {errorCount > 0 && <span className="text-del">{plural(errorCount, 'error')}</span>}
                {warningCount > 0 && <span className="text-warn">{plural(warningCount, 'warning')}</span>}
                {state.mask && <span>values masked · Copy copies the real ones</span>}
              </div>
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}

function plural(n: number, word: string): string {
  return `${formatCount(n)} ${word}${n === 1 ? '' : 's'}`
}

function Issues({ issues }: { issues: readonly EnvIssue[] }) {
  const shown = issues.slice(0, MAX_ISSUES)
  return (
    <ul
      aria-label="Problems"
      className="max-h-40 shrink-0 space-y-1 overflow-y-auto border-t border-border px-3 py-2 text-[12px] leading-snug scroll-thin"
    >
      {shown.map((issue) => {
        const error = issue.severity === 'error'
        const Icon = error ? CircleX : TriangleAlert
        return (
          <li key={issueId(issue)} className={error ? 'flex gap-1.5 text-del' : 'flex gap-1.5 text-warn'}>
            <Icon size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span className="w-10 shrink-0 font-mono text-faint">L{issue.line}</span>
            <span className="min-w-0 wrap-break-word">{issue.message}</span>
          </li>
        )
      })}
      {issues.length > MAX_ISSUES && (
        <li className="text-faint">… and {formatCount(issues.length - MAX_ISSUES)} more</li>
      )}
    </ul>
  )
}
