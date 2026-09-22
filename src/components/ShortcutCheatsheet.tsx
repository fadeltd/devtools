import { listShortcuts } from '@/lib/keys/registry'
import { renderCombo } from '@/lib/keys/platform'

/**
 * Rendered from the live shortcut registry, so this can never drift out of
 * sync with what the keys actually do.
 */
export function ShortcutCheatsheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  // Read at render time: the component only mounts while open, so this is
  // always a fresh snapshot of what the keys currently do.
  const shortcuts = listShortcuts()

  const groups = new Map<string, typeof shortcuts>()
  for (const s of shortcuts) {
    const list = groups.get(s.group) ?? []
    list.push(s)
    groups.set(s.group, list)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0" />
      <div className="panel relative z-10 max-h-[80vh] w-full max-w-[560px] overflow-y-auto p-4 scroll-thin">
        <h2 className="text-[13px] font-semibold">Keyboard shortcuts</h2>
        {groups.size === 0 && (
          <p className="mt-3 text-[13px] text-faint">No shortcuts registered.</p>
        )}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {[...groups].map(([group, items]) => (
            <div key={group}>
              <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
                {group}
              </h3>
              <dl className="flex flex-col gap-1">
                {items.map((s) => (
                  <div key={`${s.scope}:${s.combo}`} className="flex items-center gap-2">
                    <dt className="flex-1 text-[12px] text-muted">{s.label}</dt>
                    <dd>
                      <kbd className="rounded border border-border bg-surface-2 px-1.5 py-px font-mono text-[11px] text-fg">
                        {renderCombo(s.combo)}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
