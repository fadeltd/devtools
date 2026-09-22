import type { ReactNode } from 'react'
import { cn } from '@/lib/util/cn'

type Tone = 'neutral' | 'accent' | 'warn' | 'add' | 'del'

const TONES: Record<Tone, string> = {
  neutral: 'border-border text-muted',
  accent: 'border-accent text-accent',
  warn: 'border-warn/50 text-warn',
  add: 'border-add/50 text-add',
  del: 'border-del/50 text-del',
}

export function Badge({
  tone = 'neutral',
  className,
  title,
  children,
}: {
  tone?: Tone
  className?: string
  title?: string
  children: ReactNode
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-[4px] border px-1.5 py-px font-mono text-[11px] leading-[14px] tracking-[0.02em]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
