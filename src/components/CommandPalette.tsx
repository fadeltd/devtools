import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Command } from 'cmdk'
import { Pin, PinOff, Settings, Trash2 } from 'lucide-react'
import { TOOLS_BY_SLUG, warmTool, type Tool, type ToolSlug } from '@/lib/registry'
import { searchTools } from '@/lib/registry/search'
import { CATEGORY_LABELS } from '@/lib/registry/types'
import { MAX_PINS, recentSlugs, togglePin, usePrefs } from '@/lib/prefs'
import { clearAllData } from '@/lib/persist/clear'
import { renderCombo } from '@/lib/keys/platform'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const prefs = usePrefs()
  const [query, setQuery] = useState('')

  const results = useMemo(() => searchTools(query), [query])
  const recent = useMemo(() => {
    if (query.trim()) return []
    return recentSlugs(prefs).map((slug) => TOOLS_BY_SLUG[slug])
  }, [prefs, query])

  const recentSet = new Set(recent.map((t) => t.slug))
  const rest = results.filter((t) => !recentSet.has(t.slug))

  function close() {
    onOpenChange(false)
    setQuery('')
  }

  function openTool(slug: string) {
    close()
    void navigate(`/${slug}`)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgb(10_10_12/0.75)] p-4 pt-[10vh]">
      <button type="button" aria-label="Close" onClick={close} className="absolute inset-0" />
      <Command
        // cmdk's own filter only sees rendered text; we score over titles,
        // keywords and categories in lib/registry/search.ts instead.
        shouldFilter={false}
        loop
        label="Search tools"
        className="panel relative z-10 flex max-h-[400px] w-full max-w-[640px] flex-col overflow-hidden bg-surface-2"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search tools and actions…"
          className="h-10 w-full shrink-0 border-b border-border bg-transparent px-3 text-[14px] text-fg placeholder:text-faint focus:outline-none"
        />

        <Command.List className="flex-1 overflow-y-auto p-1.5 scroll-thin">
          <Command.Empty className="px-2 py-6 text-center text-[13px] text-faint">
            No tool matches “{query}”.
          </Command.Empty>

          {recent.length > 0 && (
            <Command.Group
              heading="Recent"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint"
            >
              {recent.map((tool) => (
                <ToolRow
                  key={`recent-${tool.slug}`}
                  tool={tool}
                  pinIndex={prefs.pins.indexOf(tool.slug as ToolSlug)}
                  onSelect={openTool}
                />
              ))}
            </Command.Group>
          )}

          <Command.Group
            heading="Tools"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint"
          >
            {rest.map((tool) => (
              <ToolRow
                key={tool.slug}
                tool={tool}
                pinIndex={prefs.pins.indexOf(tool.slug as ToolSlug)}
                onSelect={openTool}
              />
            ))}
          </Command.Group>

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint"
          >
            {/* Pinning is an action you go looking for, so it only appears
                once you have typed something. */}
            {query.trim() !== '' &&
              results.map((tool) => {
                const pinned = prefs.pins.includes(tool.slug as ToolSlug)
                const full = !pinned && prefs.pins.length >= MAX_PINS
                return (
                  <Command.Item
                    key={`pin-${tool.slug}`}
                    value={`pin-${tool.slug}`}
                    disabled={full}
                    onSelect={() => togglePin(tool.slug as ToolSlug)}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[4px] px-3 text-[13px] text-muted data-[disabled=true]:opacity-40 data-[selected=true]:bg-surface-2 data-[selected=true]:text-accent md:min-h-8"
                  >
                    {pinned ? <PinOff size={15} aria-hidden /> : <Pin size={15} aria-hidden />}
                    <span className="flex-1 truncate">
                      {pinned ? `Unpin ${tool.title}` : `Pin ${tool.title}`}
                      {full && ' (9 pins max)'}
                    </span>
                  </Command.Item>
                )
              })}

            <Command.Item
              value="settings"
              onSelect={() => openTool('settings')}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[4px] px-3 text-[13px] text-muted data-[selected=true]:bg-surface-2 data-[selected=true]:text-accent md:min-h-8"
            >
              <Settings size={15} aria-hidden />
              <span className="flex-1">Settings</span>
            </Command.Item>

            <Command.Item
              value="clear-all-saved-data"
              onSelect={() => {
                if (confirm('Delete all saved inputs and preferences? This cannot be undone.')) {
                  void clearAllData()
                }
              }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[4px] px-3 text-[13px] text-del data-[selected=true]:bg-del-bg md:min-h-8"
            >
              <Trash2 size={15} aria-hidden />
              <span className="flex-1">Clear all saved data</span>
            </Command.Item>
          </Command.Group>
        </Command.List>

        <div className="hidden shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 font-mono text-[10px] text-faint md:flex">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </Command>
    </div>
  )
}

function ToolRow({
  tool,
  pinIndex,
  onSelect,
}: {
  tool: Tool
  pinIndex: number
  onSelect: (slug: string) => void
}) {
  return (
    <Command.Item
      value={tool.slug}
      // Highlighting prefetches the tool's chunk, so Enter feels instant.
      onMouseEnter={() => warmTool(tool.slug)}
      onSelect={() => onSelect(tool.slug)}
      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[4px] px-3 text-[13px] text-muted data-[selected=true]:bg-surface-2 data-[selected=true]:text-accent md:min-h-8"
    >
      <tool.icon size={15} className="shrink-0" aria-hidden />
      <span className="flex-1 truncate">{tool.title}</span>
      {pinIndex >= 0 && (
        <kbd className="rounded-[4px] border border-border bg-white/[0.04] px-1 font-mono text-[10px]">
          {renderCombo(`mod+${pinIndex + 1}`)}
        </kbd>
      )}
      <span className="text-[11px] text-faint">{CATEGORY_LABELS[tool.category]}</span>
    </Command.Item>
  )
}
