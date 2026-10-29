import type { Remote } from 'comlink'
import { useDeferredValue, useMemo, useRef, type ReactNode } from 'react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select, Toggle } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import { useWorkerJob, type JobStatus } from '@/lib/worker/useWorkerJob'
import type { CsvIssue, Delimiter } from '@fadeltd/devtools-core/csv'
import { CsvGrid } from './CsvGrid'
import type { CsvApi, CsvFormat, CsvRunInput, CsvRunResult } from './csv.worker'

type DelimiterChoice = Delimiter | 'auto'

interface State {
  text: string
  delimiter: DelimiterChoice
  header: boolean
  format: CsvFormat
}

const INITIAL: State = { text: '', delimiter: 'auto', header: true, format: 'table' }

const DELIMITER_NAME: Record<Delimiter, string> = {
  ',': 'comma',
  '\t': 'tab',
  ';': 'semicolon',
  '|': 'pipe',
}

const FORMATS: [CsvFormat, string][] = [
  ['table', 'Table'],
  ['json', 'JSON'],
  ['markdown', 'Markdown'],
  ['csv', 'CSV'],
  ['tsv', 'TSV'],
]
const FORMAT_LABEL = Object.fromEntries(FORMATS) as Record<CsvFormat, string>

/** Rendering every one of up to 1,000 stored issues helps nobody. */
const SHOWN_ISSUES = 100

// Module-level so useWorkerJob sees stable references.
function spawnCsv() {
  return new Worker(new URL('./csv.worker.ts', import.meta.url), { type: 'module' })
}

function runInWorker(api: Remote<CsvApi>, input: CsvRunInput): Promise<CsvRunResult> {
  return api.run(input)
}

function RunStatus({
  status,
  error,
  onCancel,
}: {
  status: JobStatus
  error: string | undefined
  onCancel: () => void
}) {
  switch (status) {
    case 'slow':
      return (
        <>
          <Badge tone="warn">Still parsing after 2s</Badge>
          <Button variant="danger" onClick={onCancel}>
            Cancel
          </Button>
        </>
      )
    case 'cancelled':
      return (
        <Badge tone="del" title="Edit the input or an option to run again">
          Cancelled — showing the last finished parse
        </Badge>
      )
    case 'error':
      return <Badge tone="del">{error}</Badge>
    case 'running':
    case 'done':
      return null
  }
}

function issueWhere(issue: CsvIssue): string {
  const row = issue.row === 0 ? 'header' : `row ${formatCount(issue.row)}`
  return `Line ${formatCount(issue.line)}:${issue.column} · ${row}`
}

export default function CsvTool() {
  useToolUsageTracker('csv')
  const { state, setState, reset, hydrating } = useToolState<State>('csv', INITIAL)

  // Keeps typing responsive: the worker runs against a deferred snapshot.
  const deferredText = useDeferredValue(state.text)
  const input = useMemo<CsvRunInput>(
    () => ({ text: deferredText, delimiter: state.delimiter, header: state.header, format: state.format }),
    [deferredText, state.delimiter, state.header, state.format],
  )
  const job = useWorkerJob(spawnCsv, runInWorker, input)
  const result = job.result
  // The last finished result may be for a different format while a new run is
  // in flight, so draw what the result holds, not what the control says.
  const shownFormat = result?.format ?? state.format
  const output = result?.output ?? ''
  const current = job.status === 'done' && deferredText === state.text

  const inputRef = useRef<HTMLDivElement>(null)

  /** Puts the caret on the problem in the input, which is where it gets fixed. */
  function selectInInput(issue: CsvIssue) {
    const ta = inputRef.current?.querySelector('textarea')
    // Offsets are only valid for the text this result was parsed from.
    if (!ta || !current) return
    let end = issue.offset + 1
    if (issue.kind === 'ragged') {
      const nl = state.text.slice(issue.offset).search(/\r|\n/)
      end = nl < 0 ? state.text.length : issue.offset + nl
    }
    ta.focus()
    ta.setSelectionRange(issue.offset, end)
  }

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy output',
      group: 'CSV to Table',
      scope: 'tool',
      whileTyping: true,
      run: () => {
        if (output !== '') void copyText(output)
      },
    },
  ])

  let body: ReactNode
  if (state.text === '') {
    body = (
      <p className="p-3 text-[12px] text-faint">
        {hydrating ? 'Restoring your last input…' : 'Paste CSV or TSV to see it as a table.'}
      </p>
    )
  } else if (result === undefined) {
    body = <p className="p-3 text-[12px] text-faint">Parsing…</p>
  } else if (shownFormat === 'table') {
    body =
      result.rowCount === 0 && result.header === null ? (
        <p className="p-3 text-[12px] text-faint">No rows.</p>
      ) : (
        <CsvGrid result={result} />
      )
  } else {
    body = <CodeArea value={output} readOnly placeholder="Output appears here" />
  }

  const issues = result?.issues ?? []
  const delimiterName = result === undefined ? undefined : DELIMITER_NAME[result.delimiter]

  return (
    <ToolFrame
      slug="csv"
      actions={
        <>
          <Select
            value={state.delimiter}
            onChange={(e) => setState((p) => ({ ...p, delimiter: e.target.value as DelimiterChoice }))}
            aria-label="Delimiter"
            title="Delimiter"
          >
            <option value="auto">
              {result?.detected === true && delimiterName !== undefined
                ? `Auto · ${delimiterName}`
                : 'Auto-detect'}
            </option>
            <option value=",">Comma ,</option>
            <option value={'\t'}>Tab</option>
            <option value=";">Semicolon ;</option>
            <option value="|">Pipe |</option>
          </Select>
          <Toggle checked={state.header} onChange={(v) => setState((p) => ({ ...p, header: v }))}>
            Header row
          </Toggle>
          <Select
            value={state.format}
            onChange={(e) => setState((p) => ({ ...p, format: e.target.value as CsvFormat }))}
            aria-label="Output format"
            title="Output format"
          >
            {FORMATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {state.format !== 'table' && <CopyButton value={output} />}
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel="CSV"
        rightLabel={FORMAT_LABEL[state.format]}
        left={
          <div ref={inputRef} className="flex min-h-0 w-full">
            <CodeArea
              value={state.text}
              onChange={(e) => setState((p) => ({ ...p, text: e.target.value }))}
              placeholder={'Paste CSV, TSV or semicolon-separated data…\n\nname,role\nAda,"Engineer, first"'}
            />
          </div>
        }
        right={
          <div className="flex min-h-0 w-full flex-col border-t border-border md:border-t-0 md:border-l">
            {result !== undefined && state.text !== '' && (
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted">
                <span>
                  {formatCount(result.rowCount)} row{result.rowCount === 1 ? '' : 's'} ×{' '}
                  {formatCount(result.columns)} column{result.columns === 1 ? '' : 's'}
                </span>
                <span>
                  {delimiterName}
                  {result.detected ? ', detected' : ''}
                </span>
                {result.bom && (
                  <Badge title="A UTF-8 byte-order mark was stripped from the start">BOM</Badge>
                )}
                {result.blankLines > 0 && (
                  <span>
                    {formatCount(result.blankLines)} blank line{result.blankLines === 1 ? '' : 's'} skipped
                  </span>
                )}
                {result.issueCount > 0 && (
                  <Badge tone="warn">
                    {formatCount(result.issueCount)} warning{result.issueCount === 1 ? '' : 's'}
                  </Badge>
                )}
                <RunStatus status={job.status} error={job.error} onCancel={job.cancel} />
              </div>
            )}

            {issues.length > 0 && state.text !== '' && (
              <ul
                aria-label="Warnings"
                className="max-h-32 shrink-0 overflow-y-auto border-b border-border bg-surface py-0.5 font-mono text-[12px] scroll-thin"
              >
                {issues.slice(0, SHOWN_ISSUES).map((issue) => (
                  <li key={`${issue.kind}:${issue.offset}:${issue.message}`}>
                    <button
                      type="button"
                      onClick={() => selectInInput(issue)}
                      disabled={!current}
                      title="Select in input"
                      className="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-surface-2 disabled:cursor-default md:min-h-6"
                    >
                      <span className="shrink-0 tabular-nums text-warn">{issueWhere(issue)}</span>
                      <span className="min-w-0 truncate text-muted">{issue.message}</span>
                    </button>
                  </li>
                ))}
                {result !== undefined && result.issueCount > SHOWN_ISSUES && (
                  <li className="px-3 py-1 text-faint">
                    and {formatCount(result.issueCount - SHOWN_ISSUES)} more
                  </li>
                )}
              </ul>
            )}

            {body}
          </div>
        }
      />
    </ToolFrame>
  )
}
