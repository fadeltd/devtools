/**
 * Copy text to the clipboard.
 *
 * MUST be called directly inside a click/keydown handler. Safari rejects a
 * clipboard write that happens after an await or from an effect, silently.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
