import type { ReactNode } from 'react'
import { TOOLS_BY_SLUG, type ToolSlug } from '@/lib/registry'
import { Badge } from '@/components/ui/Badge'

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
          <h1 className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.005em]">
            {tool.title}
            {tool.store.kind === 'none' && (
              <Badge tone="warn" title={tool.store.reason}>
                Not saved
              </Badge>
            )}
          </h1>
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
