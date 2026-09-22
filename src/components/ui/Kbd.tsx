import { cn } from '@/lib/util/cn'

/** Renders a shortcut chip. Hidden on touch, where there is no keyboard. */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cn(
        'hidden rounded-[4px] border border-border bg-white/[0.04] px-1 py-px',
        'font-mono text-[10px] leading-4 text-muted md:inline-block',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
