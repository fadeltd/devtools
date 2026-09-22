import type { ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/util/cn'

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'min-h-11 shrink-0 rounded-[4px] border border-border bg-bg px-1.5 text-fg',
        'hover:border-border-strong md:min-h-7',
        className,
      )}
      {...rest}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="flex min-h-11 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap md:min-h-7">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        // 14px box, inverse fill when checked, per the design's checkbox spec.
        className="size-3.5 appearance-none rounded-[3px] border border-border bg-bg
                   checked:border-fg checked:bg-fg
                   checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><path d=%22M3.5 8.5l3 3 6-6%22 fill=%22none%22 stroke=%22%23121316%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/></svg>')]
                   checked:bg-center checked:bg-no-repeat"
      />
      <span className="text-[12px] text-muted">{children}</span>
    </label>
  )
}
