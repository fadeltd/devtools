/** Compact hex dump, for the "this isn't UTF-8" escape hatch. */
export function hexDump(bytes: Uint8Array, maxBytes = 4096): string {
  const limit = Math.min(bytes.length, maxBytes)
  const lines: string[] = []

  for (let offset = 0; offset < limit; offset += 16) {
    const row = bytes.subarray(offset, Math.min(offset + 16, limit))
    const hex = [...row].map((b) => b.toString(16).padStart(2, '0'))
    const left = hex.slice(0, 8).join(' ').padEnd(23, ' ')
    const right = hex.slice(8).join(' ').padEnd(23, ' ')
    const ascii = [...row].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${left}  ${right}  |${ascii}|`)
  }

  if (bytes.length > limit) {
    lines.push(`… ${bytes.length - limit} more bytes`)
  }
  return lines.join('\n')
}
