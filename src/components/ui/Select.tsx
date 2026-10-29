import type { ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/util/cn'

/**
 * The native arrow sits outside the padding box and cannot be styled, so it
 * collides with the border at our control height. We suppress it with
 * appearance-none and draw our own chevron as a background image, leaving
 * explicit room for it on the right.
 */
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%238b8d98' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")"

export function Select({ className, style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      style={{ backgroundImage: CHEVRON, ...style }}
      className={cn(
        'min-h-11 shrink-0 appearance-none rounded-[4px] border border-border bg-bg',
        // Room for the chevron on the right, comfortable text inset on the left.
        'py-1 pl-2.5 pr-8 text-fg',
        'bg-[length:14px_14px] bg-[right_8px_center] bg-no-repeat',
        'hover:border-border-strong md:min-h-7 md:py-0',
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
        // The tick is drawn by .toggle-box in global.css.
        className="toggle-box size-3.5 appearance-none rounded-[3px] border border-border bg-bg
                   checked:border-fg checked:bg-fg"
      />
      <span className="text-[12px] text-muted">{children}</span>
    </label>
  )
}
