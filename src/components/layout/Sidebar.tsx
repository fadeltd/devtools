import { NavLink } from 'react-router'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { CATEGORIES, CATEGORY_LABELS, VISIBLE_TOOLS, warmTool } from '@/lib/registry'
import { toggleSidebar, usePrefs } from '@/lib/prefs'
import { cn } from '@/lib/util/cn'

function ToolLinks({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean
  onNavigate?: () => void
}) {
  return (
    <nav className={cn('flex flex-col gap-4 p-3', collapsed && 'items-center gap-3 px-1.5')}>
      {CATEGORIES.map((category) => {
        const tools = VISIBLE_TOOLS.filter((t) => t.category === category)
        if (tools.length === 0) return null
        return (
          <div key={category} className={cn(collapsed && 'flex w-full flex-col items-center gap-1')}>
            {collapsed ? (
              // A hairline keeps the grouping legible without a heading.
              <div className="mb-1 h-px w-5 bg-border first:hidden" aria-hidden />
            ) : (
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.02em] text-faint">
                  {CATEGORY_LABELS[category]}
                </span>
                <span className="font-mono text-[11px] text-faint">{tools.length}</span>
              </div>
            )}

            {tools.map((tool) => (
              <NavLink
                key={tool.slug}
                to={`/${tool.slug}`}
                onClick={onNavigate}
                onPointerEnter={() => warmTool(tool.slug)}
                onFocus={() => warmTool(tool.slug)}
                // The title is the only label when collapsed, so it is not
                // decorative -- it is how the rail stays usable.
                title={collapsed ? `${tool.title} — ${tool.blurb}` : undefined}
                aria-label={collapsed ? tool.title : undefined}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center rounded-[4px] text-[13px]',
                    collapsed ? 'w-9 justify-center md:min-h-9' : 'gap-2 px-2 md:min-h-7',
                    isActive
                      ? collapsed
                        ? 'bg-surface-2 text-accent'
                        : 'border-l-2 border-accent bg-surface-2 pl-1.5 text-accent'
                      : 'text-muted hover:bg-surface hover:text-fg',
                  )
                }
              >
                <tool.icon size={15} aria-hidden className="shrink-0" />
                {!collapsed && (
                  <span className="truncate opacity-0 animate-[fadeIn_150ms_ease-out_forwards]">
                    {tool.title}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  const { sidebarCollapsed } = usePrefs()

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col overflow-hidden border-r border-border bg-surface md:flex',
        // Animating width needs overflow-hidden above, or the labels spill
        // across the main pane mid-transition. Respects reduced-motion.
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        sidebarCollapsed ? 'w-[52px]' : 'w-[220px]',
      )}
    >
      {/* At the top, where it is actually visible, and aligned with the header
          row rather than buried under the tool list. */}
      <div
        className={cn(
          'flex h-9 shrink-0 items-center border-b border-border',
          sidebarCollapsed ? 'justify-center px-0' : 'justify-end px-2',
        )}
      >
        <button
          type="button"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidebarCollapsed}
          className="flex size-7 items-center justify-center rounded-[4px] text-faint hover:bg-surface-2 hover:text-fg"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={15} aria-hidden />
          ) : (
            <PanelLeftClose size={15} aria-hidden />
          )}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <ToolLinks collapsed={sidebarCollapsed} />
      </div>
    </aside>
  )
}

export function SidebarSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="absolute inset-y-0 left-0 flex w-[min(280px,85vw)] flex-col overflow-y-auto border-r border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="font-mono text-[13px]">devtools</span>
          <button type="button" onClick={onClose} aria-label="Close menu" className="p-2">
            <X size={16} />
          </button>
        </div>
        {/* Always full labels on mobile: the sheet has room, and a rail would
            be a worse target. */}
        <ToolLinks onNavigate={onClose} />
      </div>
    </div>
  )
}
