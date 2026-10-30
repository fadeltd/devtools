import { cn } from '@/lib/util/cn'

/**
 * A checkerboard behind a translucent swatch, so 50% red reads as see-through
 * rather than as pink. This is content (the user's color), not chrome, which
 * is why it may use a gradient where the rest of the UI never does.
 */
const CHECKER = {
  backgroundColor: '#24252c',
  backgroundImage: 'repeating-conic-gradient(#3e404d 0 25%, transparent 0 50%)',
  backgroundSize: '16px 16px',
} as const

/**
 * Paints a user's color. `css` must come from the core formatters (formatHex,
 * formatOklch…), never from raw input: it is only ever a style value, but a
 * canonical string is also one we know the browser will accept.
 */
export function Swatch({
  css,
  translucent,
  className,
  label,
}: {
  css: string
  translucent: boolean
  className?: string
  label?: string
}) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-[4px] border border-border', className)}
      style={translucent ? CHECKER : undefined}
      role="img"
      aria-label={label ?? css}
    >
      <div className="absolute inset-0" style={{ background: css }} />
    </div>
  )
}
