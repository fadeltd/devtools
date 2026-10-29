import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CircleX, TriangleAlert } from 'lucide-react'
import { ToolFrame } from '@/components/layout/ToolFrame'
import { TwoPane } from '@/components/layout/TwoPane'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CodeArea } from '@/components/ui/CodeArea'
import { CopyButton } from '@/components/ui/CopyButton'
import { Select } from '@/components/ui/Select'
import { useToolState } from '@/lib/persist/useToolState'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import { useToolUsageTracker } from '@/lib/prefs'
import { copyText } from '@/lib/util/clipboard'
import { formatCount } from '@/lib/util/bytes'
import {
  exampleToken,
  parseJwt,
  withClaims,
  type ClaimRow,
  type JsonSegment,
  type JwtIssue,
  type JwtResult,
  type TokenPart,
  type ValidityStatus,
} from '@fadeltd/devtools-core/jwt'

interface State {
  token: string
  skew: number
}

// The registry declares store 'none', so useToolState keeps this in memory
// only. The token is a bearer credential and must never reach storage or a URL.
const INITIAL: State = { token: '', skew: 0 }

const SKEWS = [
  { value: 0, label: 'No leeway' },
  { value: 30, label: '30 s leeway' },
  { value: 60, label: '1 min leeway' },
  { value: 300, label: '5 min leeway' },
]

const STATUS: Record<ValidityStatus, { label: string; tone: 'add' | 'warn' | 'del'; title: string }> = {
  valid: { label: 'Not expired', tone: 'add', title: 'Inside its exp/nbf window. Says nothing about the signature.' },
  expired: { label: 'Expired', tone: 'del', title: 'Now is at or after exp (plus any leeway).' },
  'not-yet-valid': { label: 'Not yet valid', tone: 'warn', title: 'Now is before nbf (minus any leeway).' },
  'no-expiry': { label: 'No expiry', tone: 'warn', title: 'There is no exp claim.' },
  unknown: { label: 'Expiry unreadable', tone: 'warn', title: 'exp or nbf is not a number.' },
}

// Hoisted: constructing a DateTimeFormat per row per tick is the slow path.
const LOCAL_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' })

/** The summary line is a convenience; a pasted megabyte has no business in it. */
const MAX_SUMMARY = 4000
const MAX_JSON_ROWS = 18

export default function JwtTool() {
  useToolUsageTracker('jwt')
  const { state, setState, reset } = useToolState<State>('jwt', INITIAL)

  const token = useDeferredValue(state.token)
  const parsed = useMemo(() => parseJwt(token), [token])

  // Structure is parsed once per edit; only the clock-dependent part re-runs on
  // the tick, so a token visibly expires while you look at it.
  const [now, setNow] = useState(() => Date.now())
  const ticking = parsed.kind === 'jws'
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])

  const result = useMemo(
    () => withClaims(parsed, { now, clockSkewSeconds: state.skew }),
    [parsed, now, state.skew],
  )

  const payloadText = result.payload?.pretty ?? ''

  useShortcuts([
    {
      combo: 'mod+shift+c',
      label: 'Copy payload',
      group: 'JWT Decoder',
      scope: 'tool',
      whileTyping: true,
      run: () => void copyText(payloadText),
    },
  ])

  return (
    <ToolFrame
      slug="jwt"
      actions={
        <>
          <Select
            value={state.skew}
            onChange={(e) => setState((p) => ({ ...p, skew: Number(e.target.value) }))}
            title="Clock skew allowed on exp and nbf"
          >
            {SKEWS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button
            onClick={() => {
              setNow(Date.now())
              setState((p) => ({ ...p, token: exampleToken(Date.now()) }))
            }}
          >
            Example
          </Button>
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        </>
      }
    >
      <TwoPane
        leftLabel="Token"
        rightLabel="Decoded"
        left={
          <div className="flex min-h-0 w-full flex-col">
            <CodeArea
              value={state.token}
              onChange={(e) => setState((p) => ({ ...p, token: e.target.value }))}
              placeholder="Paste a JWT — eyJhbGciOi… — with or without “Bearer”"
              className="break-all"
            />
            {result.parts.length > 0 && <TokenSummary result={result} />}
          </div>
        }
        right={
          <div className="min-h-0 w-full overflow-y-auto border-t border-border scroll-thin md:border-t-0 md:border-l">
            {result.token === '' ? (
              <p className="p-3 text-[12px] text-faint">
                The header, payload and claims appear here. The token is decoded in this tab and is
                never saved or sent anywhere.
              </p>
            ) : (
              <Decoded result={result} />
            )}
          </div>
        }
      />
    </ToolFrame>
  )
}

function Decoded({ result }: { result: JwtResult }) {
  const { status, kind, header, payload, signature, encrypted, claims, errors, warnings } = result
  const alg = header?.ok === true ? (header.value as Record<string, unknown> | null)?.['alg'] : undefined

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        {status !== null && (
          <Badge tone={STATUS[status].tone} title={STATUS[status].title}>
            {STATUS[status].label}
          </Badge>
        )}
        {kind !== null && <Badge>{kind === 'jws' ? 'JWS · signed' : 'JWE · encrypted'}</Badge>}
        {typeof alg === 'string' && <Badge>{alg.length > 24 ? `${alg.slice(0, 24)}…` : alg}</Badge>}
        {kind === 'jws' && (
          <Badge title="This tool holds no key, so it cannot check the signature.">
            Signature not verified
          </Badge>
        )}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="space-y-1 border-b border-border px-3 py-2 text-[12px] leading-snug">
          {errors.map((issue) => (
            <Issue key={`e:${issue.message}`} issue={issue} error />
          ))}
          {warnings.map((issue) => (
            <Issue key={`w:${issue.message}`} issue={issue} />
          ))}
        </ul>
      )}

      {header !== null && <JsonSection title="Header" segment={header} />}

      {kind === 'jws' && payload !== null && <JsonSection title="Payload" segment={payload} />}

      {kind === 'jwe' && (
        <Section title="Payload">
          <p className="px-3 pb-2 text-[12px] text-muted">
            Encrypted. The payload cannot be read without the recipient’s private key, which never
            belongs in a web page.
          </p>
          {encrypted !== null && encrypted.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 px-3 pb-3 font-mono text-[12px]">
              {encrypted.map((e) => (
                <div key={e.name} className="contents">
                  <dt className="text-muted">{e.name}</dt>
                  <dd>{formatCount(e.bytes)} bytes</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
      )}

      {claims.length > 0 && (
        <Section title="Registered claims">
          <div className="border-t border-border">
            {claims.map((c) => (
              <ClaimLine key={c.name} claim={c} />
            ))}
          </div>
        </Section>
      )}

      {signature !== null && (
        <Section
          title="Signature"
          action={<CopyButton value={signature.base64url} label="Copy" />}
        >
          <p className="px-3 pb-1 font-mono text-[12px] text-muted">
            {formatCount(signature.bytes)} bytes · <span className="text-warn">not verified</span>
          </p>
          {signature.base64url !== '' && (
            <p className="mx-3 mb-3 max-h-24 overflow-y-auto break-all rounded-[4px] border border-border bg-bg p-2 font-mono text-[12px] leading-[18px] text-muted scroll-thin">
              {signature.base64url}
            </p>
          )}
        </Section>
      )}
    </>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-border">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.02em] text-faint">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function JsonSection({ title, segment }: { title: string; segment: JsonSegment }) {
  const rows = Math.min(Math.max(segment.pretty.split('\n').length, 2), MAX_JSON_ROWS)
  return (
    <Section title={title} action={<CopyButton value={segment.pretty} />}>
      {segment.text === null ? (
        <p className="px-3 pb-2 text-[12px] text-faint">Nothing readable to show.</p>
      ) : (
        // Auto-height wrapper: CodeArea's h-full resolves to auto here, so `rows` sizes it.
        <div className="border-t border-border">
          <CodeArea value={segment.pretty} readOnly rows={rows} aria-label={`${title} JSON`} />
        </div>
      )}
    </Section>
  )
}

function ClaimLine({ claim }: { claim: ClaimRow }) {
  const { time } = claim
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 border-b border-border px-3 py-1.5 last:border-b-0">
      <div>
        <div className="font-mono text-[12px] text-fg">{claim.name}</div>
        <div className="text-[11px] text-faint">{claim.label}</div>
      </div>
      <div className="min-w-0 break-all font-mono text-[12px] leading-[18px]">
        {time === null ? (
          <span className="text-fg">{claim.display}</span>
        ) : (
          <>
            <div className="text-fg">
              {time.iso === null ? claim.display : LOCAL_TIME.format(time.ms)}
              <span className="text-muted"> · {time.relative}</span>
            </div>
            <div className="text-faint">
              {time.iso ?? 'out of range'} · {claim.display}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Issue({ issue, error = false }: { issue: JwtIssue; error?: boolean }) {
  const Icon = error ? CircleX : TriangleAlert
  return (
    <li className={error ? 'flex gap-1.5 text-del' : 'flex gap-1.5 text-warn'}>
      <Icon size={13} className="mt-[2px] shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{issue.message}</span>
    </li>
  )
}

/**
 * The token with each segment set apart by tone, and the first bad character
 * marked. Plain text nodes in a handful of spans: bounded, never HTML.
 */
function TokenSummary({ result }: { result: JwtResult }) {
  const marked = result.errors.find((e) => e.position !== undefined)?.position
  const truncated = result.token.length > MAX_SUMMARY

  const pieces: ReactNode[] = []
  for (const [i, part] of result.parts.entries()) {
    if (part.start >= MAX_SUMMARY) break
    if (i > 0) {
      pieces.push(
        <span key={`dot${i}`} className="font-bold text-faint">
          .
        </span>,
      )
    }
    pieces.push(<Segment key={part.name} part={part} marked={marked} even={i % 2 === 0} />)
  }

  return (
    <div className="shrink-0 border-t border-border">
      <p className="max-h-24 overflow-y-auto break-all px-3 py-1.5 font-mono text-[12px] leading-[18px] scroll-thin">
        {pieces}
        {truncated && (
          <span className="text-faint"> … {formatCount(result.token.length - MAX_SUMMARY)} more</span>
        )}
      </p>
      <p className="flex flex-wrap gap-x-3 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
        {result.parts.map((p) => (
          <span key={p.name}>
            {p.name} {formatCount(p.text.length)}
          </span>
        ))}
      </p>
    </div>
  )
}

function Segment({ part, marked, even }: { part: TokenPart; marked: number | undefined; even: boolean }) {
  const tone = even ? 'text-fg' : 'text-muted'
  const visible = part.text.slice(0, Math.max(0, MAX_SUMMARY - part.start))
  const at = marked === undefined ? -1 : marked - part.start
  if (at < 0 || at >= visible.length) return <span className={tone}>{visible}</span>

  const ch = String.fromCodePoint(visible.codePointAt(at)!)
  return (
    <span className={tone}>
      {visible.slice(0, at)}
      <span className="rounded-[2px] bg-del-bg text-del">{ch}</span>
      {visible.slice(at + ch.length)}
    </span>
  )
}
