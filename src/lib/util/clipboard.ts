export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * The route for browsers with no `ClipboardItem` (Firefox before 127) and for
 * pages not served over HTTPS, where `navigator.clipboard` does not exist.
 * `execCommand('copy')` fires a `copy` event whose data we replace, so both
 * flavours land on the clipboard without the HTML ever entering the DOM.
 * Safari only fires the event when something is selected, hence the probe.
 */
function copyRichLegacy(html: string, text: string): boolean {
  const selection = document.getSelection()
  const saved: Range[] = []
  if (selection !== null) {
    for (let i = 0; i < selection.rangeCount; i++) saved.push(selection.getRangeAt(i))
  }
  const active = document.activeElement

  const probe = document.createElement('span')
  probe.textContent = ' '
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;user-select:text'
  document.body.append(probe)

  let handled = false
  const onCopy = (e: ClipboardEvent) => {
    if (e.clipboardData === null) return
    e.clipboardData.setData('text/html', html)
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
    handled = true
  }
  document.addEventListener('copy', onCopy, true)
  try {
    const range = document.createRange()
    range.selectNodeContents(probe)
    selection?.removeAllRanges()
    selection?.addRange(range)
    // Deprecated, and still the only synchronous way to reach the clipboard.
    return document.execCommand('copy') && handled
  } catch {
    return false
  } finally {
    document.removeEventListener('copy', onCopy, true)
    probe.remove()
    selection?.removeAllRanges()
    for (const r of saved) selection?.addRange(r)
    if (active instanceof HTMLElement) active.focus({ preventScroll: true })
  }
}

/**
 * Put rich text on the clipboard, with a plain-text twin. A paste into Slack,
 * Google Docs or Gmail takes `text/html` and keeps tables and formatting; a
 * paste into a terminal or a code editor takes `text/plain`.
 *
 * Call it straight from the click handler, as with `copyText`: both routes
 * need the user gesture, and the legacy one is synchronous by nature.
 */
export async function copyRich(html: string, text: string): Promise<boolean> {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      return true
    } catch {
      // Permission denied or an unsupported type. The gesture may be spent by
      // now, in which case the legacy route fails too and we report that.
    }
  }
  try {
    return copyRichLegacy(html, text)
  } catch {
    return false
  }
}
