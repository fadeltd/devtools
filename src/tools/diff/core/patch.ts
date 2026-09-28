import { FILE_HEADERS_ONLY, createTwoFilesPatch } from 'diff'

/** Building a patch runs its own line diff; past this it gives up. */
export const PATCH_TIMEOUT_MS = 1000

/**
 * The exact unified diff that turns `a` into `b`, with 3 lines of context.
 *
 * Deliberately ignores the Ignore toggles: a patch that skipped whitespace
 * would not reproduce `b`. `null` when the inputs are too different to diff
 * within `timeoutMs`.
 */
export function toUnifiedPatch(a: string, b: string, timeoutMs = PATCH_TIMEOUT_MS): string | null {
  const patch = createTwoFilesPatch('a', 'b', a, b, '', '', {
    context: 3,
    headerOptions: FILE_HEADERS_ONLY,
    timeout: timeoutMs,
  })
  return patch ?? null
}
