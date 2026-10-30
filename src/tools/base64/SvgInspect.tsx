import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { formatBytes } from '@/lib/util/bytes'
import { downloadBlob } from '@/lib/util/download'
import {
  type Dimensions,
  type Removal,
  type StripReport,
  type SvgRoot,
  standaloneSvg,
  summarizeRemovals,
  SVG_INSPECT_MAX_BYTES,
  svgDimensions,
  svgRoot,
} from '@fadeltd/devtools-core/base64'
import { useAsyncValue } from './useAsyncValue'

interface Inspection {
  root: SvgRoot | null
  size: Dimensions | null
  report: StripReport
  /** Text only: copied or downloaded, never put into this page's DOM. */
  sanitized: string
}

type Removed = { element: Node } | { attribute: Attr | null; from: Node }

function nameOf(node: Node): string {
  // localName keeps SVG's camelCase (foreignObject) and lowercases HTML (IFRAME).
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element).localName : node.nodeName
}

// DOMPurify parses into a document of its own, and with a profile set it
// reports that document's <body> as removed. That is its wrapper, not the
// user's markup, so it is left out of the report.
const WRAPPERS = new Set(['html', 'head', 'body'])

function isWrapper(entry: Removed): boolean {
  return 'element' in entry && WRAPPERS.has(nameOf(entry.element))
}

function toRemoval(entry: Removed): Removal {
  if ('element' in entry) return { kind: 'element', name: nameOf(entry.element) }
  const attr = entry.attribute
  return {
    kind: 'attribute',
    name: attr?.name ?? 'unknown',
    element: nameOf(entry.from),
    ...(attr ? { value: attr.value } : {}),
  }
}

// The HTML parser DOMPurify uses turns an XML declaration into a bogus comment,
// which would then be "stripped" from every SVG an editor saved. It is not
// content, so it is set aside before parsing.
const PROLOG = /^﻿?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!DOCTYPE[^>[]*(?:\[[^\]]*\])?\s*>\s*)?/i

/**
 * Sanitise the source text and read back what was removed. DOMPurify parses
 * into an inert document -- no script runs and nothing is fetched -- and its
 * output only ever leaves as text. It is imported here, on first use, so it
 * stays out of every bundle but this one.
 */
async function inspectSvg(blob: Blob): Promise<Inspection> {
  const [text, { default: DOMPurify }] = await Promise.all([blob.text(), import('dompurify')])
  const sanitized = DOMPurify.sanitize(text.replace(PROLOG, ''), {
    USE_PROFILES: { svg: true, svgFilters: true },
  })
  // Read straight after the call: the next sanitize resets it.
  const removed = (DOMPurify.removed as Removed[]).filter((e) => !isWrapper(e)).map(toRemoval)
  return {
    root: svgRoot(text),
    size: svgDimensions(text),
    report: summarizeRemovals(removed),
    sanitized: sanitized === '' ? '' : standaloneSvg(sanitized),
  }
}

function sizeText(i: Inspection): string {
  const parts: string[] = []
  if (i.size) parts.push(`${Math.round(i.size.width)} × ${Math.round(i.size.height)} px`)
  else if (i.root?.width || i.root?.height) parts.push(`${i.root.width ?? 'auto'} × ${i.root.height ?? 'auto'}`)
  else parts.push('no intrinsic size')
  if (i.root?.viewBox) parts.push(`viewBox ${i.root.viewBox}`)
  return parts.join(' · ')
}

/**
 * What an SVG declares and what a sanitiser would take out of it. The point
 * is the report: an SVG is a document that can carry script, and a preview
 * through <img> (which runs none) cannot show that.
 */
export function SvgInspect({ blob, name }: { blob: Blob; name: string }) {
  if (blob.size > SVG_INSPECT_MAX_BYTES) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
        <span className="text-muted">SVG</span>
        <span>Too large to inspect ({formatBytes(blob.size)})</span>
      </div>
    )
  }
  return <SvgReport blob={blob} name={name} />
}

function SvgReport({ blob, name }: { blob: Blob; name: string }) {
  const inspection = useAsyncValue(blob, inspectSvg)

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border px-3 py-1.5 font-mono text-[11px] text-faint">
      {inspection.status === 'pending' ? (
        <span>Inspecting SVG…</span>
      ) : inspection.status === 'error' ? (
        <Badge tone="del" title={inspection.error}>
          Could not inspect this SVG
        </Badge>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-muted">SVG</span>
            <span>{sizeText(inspection.value)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" aria-label={inspection.value.report.summary}>
            {inspection.value.report.items.length === 0 ? (
              <Badge tone="add">Nothing to strip</Badge>
            ) : (
              <>
                <span>Stripped</span>
                {inspection.value.report.items.map((item) => (
                  <Badge
                    key={`${item.category}:${item.label}`}
                    tone={item.dangerous ? 'warn' : 'neutral'}
                    title={item.names.join(', ')}
                  >
                    {item.text}
                  </Badge>
                ))}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CopyButton value={inspection.value.sanitized} label="Copy sanitised SVG" />
            <Button
              disabled={inspection.value.sanitized === ''}
              onClick={() =>
                downloadBlob(new Blob([inspection.value.sanitized], { type: 'image/svg+xml' }), `${name}.sanitised.svg`)
              }
            >
              <Download size={14} aria-hidden />
              Download sanitised
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
