import { Link } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { CATEGORIES, CATEGORY_LABELS, VISIBLE_TOOLS, warmTool, type Tool } from '@/lib/registry'
import { pinnedTools, usePrefs } from '@/lib/prefs'
import { Badge } from '@/components/ui/Badge'

export default function HomePage() {
  const pinned = pinnedTools(usePrefs())

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="p-4 md:p-6">
        <h1 className="text-[15px] font-semibold">Developer tools</h1>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
          <ShieldCheck size={14} className="shrink-0 text-add" aria-hidden />
          Everything runs in your browser. Nothing you paste is ever uploaded.
        </p>

        {pinned.length > 0 && <ToolSection label="Pinned" tools={pinned} />}

        {CATEGORIES.map((category) => {
          const tools = VISIBLE_TOOLS.filter((t) => t.category === category)
          if (tools.length === 0) return null
          return <ToolSection key={category} label={CATEGORY_LABELS[category]} tools={tools} />
        })}
      </div>
    </div>
  )
}

function ToolSection({ label, tools }: { label: string; tools: readonly Tool[] }) {
  return (
    <section className="mt-6">
      <h2 className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool) => (
          <Link
            key={tool.slug}
            to={`/${tool.slug}`}
            onPointerEnter={() => warmTool(tool.slug)}
            onFocus={() => warmTool(tool.slug)}
            className="panel group flex min-h-16 flex-col gap-1 p-3 hover:border-border-strong hover:bg-surface-2"
          >
            <div className="flex items-center gap-2">
              <tool.icon size={16} className="shrink-0 text-accent" aria-hidden />
              <span className="text-[13px] font-medium">{tool.title}</span>
              {tool.status === 'beta' && <Badge tone="warn">beta</Badge>}
            </div>
            <p className="text-[12px] leading-snug text-muted">{tool.blurb}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
