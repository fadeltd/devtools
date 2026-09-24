import { Suspense, lazy, useMemo, useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router'
import { Menu, Search, Settings, Terminal } from 'lucide-react'
import { Sidebar, SidebarSheet } from '@/components/layout/Sidebar'
// Overlays are lazy so cmdk stays out of the entry bundle -- it is never
// needed for first paint, and this is the bundle that mobile pays for.
const CommandPalette = lazy(() =>
  import('@/components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
)
const ShortcutCheatsheet = lazy(() =>
  import('@/components/ShortcutCheatsheet').then((m) => ({ default: m.ShortcutCheatsheet })),
)
import { GithubIcon } from '@/components/ui/GithubIcon'
import { Kbd } from '@/components/ui/Kbd'
import { useShortcuts } from '@/lib/keys/useShortcuts'
import type { Shortcut } from '@/lib/keys/types'
import { usePrefs } from '@/lib/prefs'

export default function RootLayout() {
  const navigate = useNavigate()
  const prefs = usePrefs()
  const [menuOpen, setMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const shortcuts = useMemo<Shortcut[]>(() => {
    const list: Shortcut[] = [
      {
        combo: 'mod+k',
        label: 'Search tools',
        group: 'Global',
        scope: 'global',
        // Must work from inside a textarea, which is where you always are.
        whileTyping: true,
        run: () => setPaletteOpen((v) => !v),
      },
      {
        combo: '?',
        label: 'Keyboard shortcuts',
        group: 'Global',
        scope: 'global',
        run: () => setHelpOpen((v) => !v),
      },
      {
        combo: 'escape',
        label: 'Close overlay',
        group: 'Global',
        scope: 'global',
        whileTyping: true,
        run: () => {
          setPaletteOpen(false)
          setHelpOpen(false)
          setMenuOpen(false)
        },
      },
    ]

    // Pins are the answer to "easy to access shortcut" without inventing 30
    // mnemonics that collide and nobody memorises.
    prefs.pins.forEach((slug, i) => {
      list.push({
        combo: `mod+${i + 1}`,
        label: `Go to ${slug}`,
        group: 'Pinned tools',
        scope: 'global',
        whileTyping: true,
        run: () => void navigate(`/${slug}`),
      })
    })

    return list
  }, [navigate, prefs.pins])

  useShortcuts(shortcuts)

  return (
    // dvh, not vh: 100vh is wrong the moment the mobile keyboard opens.
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 md:h-10 md:px-2">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className="p-2 text-muted md:hidden"
        >
          <Menu size={18} />
        </button>

        <Link to="/" className="flex items-center gap-1.5">
          <Terminal size={16} className="shrink-0 text-accent" aria-hidden />
          <span className="font-mono text-[13px] font-medium tracking-tight">
            devtools<span className="text-faint">.fadeltd.dev</span>
          </span>
        </Link>

        {/* States the product thesis where it is always visible. It is also
            literally true: there is no backend to send anything to. */}
        <span
          className="hidden items-center gap-1.5 rounded-[4px] border border-border bg-surface px-1.5 py-px font-mono text-[11px] tracking-[0.02em] text-muted sm:inline-flex"
          title="Every tool runs in your browser. There is no server to send your input to."
        >
          <span className="size-1.5 rounded-full bg-add" />
          local-only
        </span>

        <div className="flex-1" />

        {/* There is no Cmd+K on a phone, so the palette needs a real button. */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex min-h-11 items-center justify-between gap-2 rounded-[4px] border border-border bg-bg px-2 text-[12px] text-muted hover:border-border-strong hover:text-fg md:min-h-7 md:w-56"
        >
          <span className="flex items-center gap-1.5">
            <Search size={14} aria-hidden />
            <span className="hidden md:inline">Search tools or actions…</span>
          </span>
          <Kbd>⌘K</Kbd>
        </button>

        <a
          href="https://github.com/fadeltd/devtools"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Source on GitHub"
          title="Source on GitHub"
          className="flex size-11 items-center justify-center rounded-[4px] border border-transparent text-muted hover:border-border hover:bg-surface hover:text-fg md:size-7"
        >
          <GithubIcon size={15} />
        </a>

        <Link
          to="/settings"
          aria-label="Settings"
          title="Settings"
          className="flex size-11 items-center justify-center rounded-[4px] border border-transparent text-muted hover:border-border hover:bg-surface hover:text-fg md:size-7"
        >
          <Settings size={15} />
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <SidebarSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Suspense
            fallback={<div className="p-4 font-mono text-[13px] text-faint">Loading…</div>}
          >
            <Outlet />
          </Suspense>
        </main>
      </div>

      <Suspense fallback={null}>
        {paletteOpen && <CommandPalette open onOpenChange={setPaletteOpen} />}
        {helpOpen && <ShortcutCheatsheet open onClose={() => setHelpOpen(false)} />}
      </Suspense>
    </div>
  )
}
