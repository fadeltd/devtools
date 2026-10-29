import { useEffect, useState, type ReactNode } from 'react'
import { Pin } from 'lucide-react'
import { TOOLS_BY_SLUG, type ToolSlug } from '@/lib/registry'
import { MAX_PINS, togglePin, usePrefs } from '@/lib/prefs'
import { renderCombo } from '@/lib/keys/platform'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/util/cn'

/**
 * Shared chrome for every tool: SEO head tags (React 19 hoists these), the
 * title/blurb header, the action bar, and the "Not saved" badge for tools that
 * declare store.kind === 'none'.
 *
 * The action bar is a single horizontally-scrollable row on mobile and a
 * right-aligned wrap on desktop. Letting it wrap on a phone pushed the actual
 * content 400px down the screen, which is worse than a swipe.
 */
export function ToolFrame({
  slug,
  actions,
  children,
}: {
  slug: ToolSlug
  actions?: ReactNode
  children: ReactNode
}) {
  const tool = TOOLS_BY_SLUG[slug]
  const url = `https://devtools.fadeltd.dev/${tool.slug}`

  return (
    <div className="flex h-full min-h-0 flex-col">
      <title>{`${tool.title} — devtools`}</title>
      <meta name="description" content={tool.blurb} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={`${tool.title} — devtools`} />
      <meta property="og:description" content={tool.blurb} />
      <meta property="og:url" content={url} />

      <div className="shrink-0 border-b border-border bg-surface md:flex md:items-center md:gap-3 md:px-3 md:py-2">
        <div className="min-w-0 px-3 pt-2 md:px-0 md:pt-0">
          {/* The pin sits beside the heading, not inside it, so the heading's
              accessible name stays just the tool title. */}
          <div className="flex items-center gap-2">
            <h1 className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.005em]">
              {tool.title}
              {tool.store.kind === 'none' && (
                <Badge tone="warn" title={tool.store.reason}>
                  Not saved
                </Badge>
              )}
            </h1>
            <PinButton slug={slug} />
          </div>
          <p className="hidden truncate text-[12px] text-muted md:block">{tool.blurb}</p>
        </div>

        {actions !== undefined && (
          <div
            className="flex items-center gap-1.5 overflow-x-auto px-3 py-2
                       [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                       md:flex-1 md:flex-wrap md:justify-end md:overflow-visible md:px-0 md:py-0"
          >
            {actions}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * Pins put a tool at the top of the sidebar and the home grid, and give it a
 * ⌘1–9 shortcut. The button is always visible rather than revealed on hover,
 * because hover does not exist on a phone.
 */
function PinButton({ slug }: { slug: ToolSlug }) {
  const { pins } = usePrefs()
  const index = pins.indexOf(slug)
  const pinned = index >= 0
  // A refused pin needs a visible reason: a disabled button with a tooltip
  // explains nothing on touch.
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    if (!refused) return
    const t = setTimeout(() => setRefused(false), 2500)
    return () => clearTimeout(t)
  }, [refused])

  const label = pinned ? 'Unpin from the top' : 'Pin to the top'
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setRefused(!togglePin(slug))}
        aria-pressed={pinned}
        aria-label={label}
        title={pinned ? `${label} (${renderCombo(`mod+${index + 1}`)})` : label}
        className={cn(
          // Full-size touch target, with negative margins so the title row keeps
          // its height and the icon stays next to the title it belongs to.
          '-my-3 -ml-3 flex size-11 items-center justify-center rounded-[4px] md:-my-1 md:ml-0 md:size-6',
          pinned ? 'text-fg' : 'text-faint hover:text-fg',
        )}
      >
        {/* Filled when pinned: the icon shows state, the label names the action. */}
        <Pin size={13} fill={pinned ? 'currentColor' : 'none'} aria-hidden />
      </button>
      {refused && (
        <span role="status" className="text-[11px] text-warn">
          {MAX_PINS} pins max. Unpin one first.
        </span>
      )}
    </span>
  )
}
