import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { TOOLS } from '@/lib/registry'
import { clearAllData } from '@/lib/persist/clear'
import { idbKeyCount } from '@/lib/persist/idb'
import { localUsageBytes } from '@/lib/persist/store'
import { formatBytes } from '@/lib/util/bytes'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

export default function SettingsPage() {
  // localStorage is synchronous, so this needs no effect at all.
  const [localBytes] = useState(localUsageBytes)
  const [idbCount, setIdbCount] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let cancelled = false
    void idbKeyCount().then((n) => {
      if (!cancelled) setIdbCount(n)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="h-full overflow-y-auto scroll-thin p-4 md:p-6">
      <title>Settings — devtools</title>
      <meta name="robots" content="noindex" />

      <h1 className="text-[15px] font-semibold">Settings</h1>
      <p className="mt-1 max-w-prose text-[13px] text-muted">
        Everything is stored locally in this browser. It is never sent anywhere, and it is not
        synced between devices.
      </p>

      <section className="panel mt-5 max-w-2xl p-3">
        <h2 className="text-[13px] font-medium">Stored data</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-[12px]">
          <dt className="text-muted">localStorage (small state)</dt>
          <dd>{formatBytes(localBytes)}</dd>
          <dt className="text-muted">IndexedDB records (large payloads)</dt>
          <dd>{idbCount === null ? '…' : idbCount}</dd>
        </dl>

        <div className="mt-3 border-t border-border pt-3">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-warn">
                Delete all saved inputs and preferences? This cannot be undone.
              </span>
              <Button variant="danger" onClick={() => void clearAllData()}>
                Yes, clear everything
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              <Trash2 size={14} aria-hidden />
              Clear all saved data
            </Button>
          )}
        </div>
      </section>

      <section className="mt-5 max-w-2xl">
        <h2 className="text-[13px] font-medium">What each tool saves</h2>
        <div className="panel mt-2 divide-y divide-border">
          {TOOLS.map((tool) => (
            <div key={tool.slug} className="flex items-center gap-2 px-3 py-2">
              <tool.icon size={14} className="shrink-0 text-faint" aria-hidden />
              <span className="flex-1 truncate text-[13px]">{tool.title}</span>
              {tool.store.kind === 'none' ? (
                <Badge tone="warn" title={tool.store.reason}>
                  not saved
                </Badge>
              ) : (
                <Badge>{tool.store.kind === 'idb' ? 'IndexedDB' : 'localStorage'}</Badge>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
