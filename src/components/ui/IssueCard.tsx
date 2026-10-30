import { AlertTriangle } from 'lucide-react'

/**
 * The shape both the JSON analyser's `JsonIssue` and the YAML/TOML engine's
 * `Message` already have, so either can be passed straight in.
 */
export interface Issue {
  message: string
  line: number | null
  column: number | null
  /** Character offset into the input, for issues that have one. */
  offset?: number
  hint: string | null
  snippet: {
    lines: ReadonlyArray<{ number: number; text: string }>
    caretLine: number
    caretColumn: number
  } | null
}

/** A parse error: message, position, and a caret under the spot. */
export function IssueCard({ issue }: { issue: Issue }) {
  const snippet = issue.snippet
  const gutterWidth = String(snippet?.lines[snippet.lines.length - 1]?.number ?? 1).length

  return (
    <div className="panel p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-px shrink-0 text-del" aria-hidden />
        <div className="min-w-0">
          <div className="text-[13px] font-medium wrap-break-word text-fg">{issue.message}</div>
          {issue.line !== null && (
            <div className="font-mono text-[11px] text-faint">
              line {issue.line}
              {issue.column !== null && `, column ${issue.column}`}
              {issue.offset !== undefined && ` · offset ${issue.offset}`}
            </div>
          )}
        </div>
      </div>

      {snippet !== null && (
        <pre className="mt-2 overflow-x-auto font-mono text-[12px] leading-normal text-muted scroll-thin">
          {snippet.lines.map((l) => (
            <span key={l.number}>
              <span className={l.number === snippet.caretLine ? 'text-fg' : undefined}>
                {String(l.number).padStart(gutterWidth, ' ')} │ {l.text}
              </span>
              {'\n'}
              {l.number === snippet.caretLine && (
                <span className="text-del">
                  {' '.repeat(gutterWidth)} │ {' '.repeat(Math.max(0, snippet.caretColumn - 1))}▲
                  {'\n'}
                </span>
              )}
            </span>
          ))}
        </pre>
      )}

      {issue.hint !== null && <p className="mt-1 text-[12px] text-muted">{issue.hint}</p>}
    </div>
  )
}
