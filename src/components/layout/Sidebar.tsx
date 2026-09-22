import { NavLink } from 'react-router'
import { X } from 'lucide-react'
import { CATEGORIES, CATEGORY_LABELS, VISIBLE_TOOLS, warmTool } from '@/lib/registry'
import { cn } from '@/lib/util/cn'

function ToolLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4 p-3">
      {CATEGORIES.map((category) => {
        const tools = VISIBLE_TOOLS.filter((t) => t.category === category)
        if (tools.length === 0) return null
        return (
          <div key={category}>
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.02em] text-faint">
                {CATEGORY_LABELS[category]}
              </span>
              <span className="font-mono text-[11px] text-faint">{tools.length}</span>
            </div>
            {tools.map((tool) => (
              <NavLink
                key={tool.slug}
                to={`/${tool.slug}`}
                onClick={onNavigate}
                onPointerEnter={() => warmTool(tool.slug)}
                onFocus={() => warmTool(tool.slug)}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center gap-2 rounded-[4px] px-2 text-[13px] md:min-h-7',
                    isActive
                      ? 'border-l-2 border-accent bg-surface-2 pl-1.5 text-accent'
                      : 'text-muted hover:bg-surface hover:text-fg',
                  )
                }
              >
                <tool.icon size={15} aria-hidden className="shrink-0" />
                <span className="truncate">{tool.title}</span>
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}

export function Sidebar() {
  return (
    <aside className="hidden w-[220px] shrink-0 overflow-y-auto border-r border-border bg-surface scroll-thin md:block">
      <ToolLinks />
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
        <ToolLinks onNavigate={onClose} />
      </div>
    </div>
  )
}
