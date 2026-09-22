import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/util/cn'

/**
 * The default text surface for this app. A plain textarea beats an editor here:
 * it is faster on 100k lines, and it gives native find, select-all, copy and
 * undo for free. CodeMirror is only justified for diff and JSON.
 */
export function CodeArea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      className={cn(
        'h-full w-full resize-none bg-bg p-3 font-mono md:text-[12px] md:leading-[18px]',
        'text-fg placeholder:text-faint focus:outline-none scroll-thin',
        className,
      )}
      {...rest}
    />
  )
}
