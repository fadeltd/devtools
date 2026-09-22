import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/util/cn'

type Variant = 'default' | 'primary' | 'ghost' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const VARIANTS: Record<Variant, string> = {
  default: 'bg-surface border-border text-fg hover:bg-surface-2 hover:border-border-strong',
  // Primary is the inverse of the canvas, not the accent: the accent is
  // reserved for focus and active state so it keeps its meaning.
  primary: 'bg-fg border-transparent font-semibold text-bg hover:bg-white',
  ghost: 'bg-transparent border-transparent text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-transparent border-border text-del hover:bg-del-bg hover:border-del/40',
}

export function Button({ variant = 'default', className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cn(
        // 44px touch target on mobile, 28px density on desktop.
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] border px-2 text-[12px]',
        'font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        'md:min-h-7',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
  title?: string
}

/**
 * Segmented control: the design's preferred form for a small set of mutually
 * exclusive views. Faster to hit than a select, and it shows the alternatives.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: readonly SegmentOption<T>[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-[4px] border border-border bg-bg p-0.5 md:min-h-7',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'whitespace-nowrap rounded-[3px] px-2 py-1 text-[12px] font-medium transition-colors md:py-0.5',
              active ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
