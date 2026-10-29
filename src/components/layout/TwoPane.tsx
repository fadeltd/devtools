import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/util/cn'

type Side = 'left' | 'middle' | 'right'

/**
 * Side-by-side on desktop; a single column with an Input/Output switcher below
 * md. Shrinking two monospace panes to 390px is unusable, so we stack instead.
 *
 * An optional `middle` is a fixed-width column between the two (and a third tab
 * on mobile). It is a column of its own rather than part of `right`, so that the
 * input and output panes stay the same width.
 */
export function TwoPane({
  left,
  right,
  leftLabel = 'Input',
  rightLabel = 'Output',
  divider,
  middle,
  middleLabel = 'Steps',
}: {
  left: ReactNode
  right: ReactNode
  leftLabel?: string
  rightLabel?: string
  divider?: ReactNode
  middle?: ReactNode
  middleLabel?: string
}) {
  const [side, setSide] = useState<Side>('left')

  const tabs: [Side, string][] = [
    ['left', leftLabel],
    ...(middle !== undefined ? [['middle', middleLabel] as [Side, string]] : []),
    ['right', rightLabel],
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-border bg-surface md:hidden">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSide(key)}
            className={cn(
              'min-h-11 flex-1 text-[13px] font-medium transition-colors',
              side === key
                ? 'border-b-2 border-accent text-accent'
                : 'border-b-2 border-transparent text-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={cn('min-h-0 min-w-0 flex-1', side === 'left' ? 'flex' : 'hidden md:flex')}>
          {left}
        </div>
        {divider && (
          <div className="flex shrink-0 items-center justify-center gap-1.5 border-y border-border p-1.5 md:flex-col md:border-x md:border-y-0">
            {divider}
          </div>
        )}
        {middle !== undefined && (
          <div
            className={cn(
              'min-h-0 min-w-0 flex-1 md:w-75 md:flex-none md:border-l md:border-border',
              side === 'middle' ? 'flex' : 'hidden md:flex',
            )}
          >
            {middle}
          </div>
        )}
        <div className={cn('min-h-0 min-w-0 flex-1', side === 'right' ? 'flex' : 'hidden md:flex')}>
          {right}
        </div>
      </div>
    </div>
  )
}
