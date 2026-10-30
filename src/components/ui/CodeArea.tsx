import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/util/cn'

/**
 * The default text surface for this app. A plain textarea beats an editor here:
 * it is faster on 100k lines, and it gives native find, select-all, copy and
 * undo for free. CodeMirror is only justified for diff and JSON.
 *
 * Its one weak spot is a single enormous line. Chrome re-lays out the whole
 * paragraph on every edit, and soft-wrapping a 3 MB line takes seconds per
 * keystroke. A tool that expects such pastes passes `wrap="off"` once a line
 * passes ~100k characters (see `hasLongLine` in `@fadeltd/devtools-core/text`): the textarea then
 * scrolls sideways, natively and on touch, and typing stays usable.
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
        'h-full w-full resize-none bg-bg p-3 font-mono md:text-[12px] md:leading-4.5',
        'text-fg placeholder:text-faint scroll-thin',
        className,
      )}
      {...rest}
    />
  )
}
