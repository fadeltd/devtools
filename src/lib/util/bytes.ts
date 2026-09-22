const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** Human byte size. Uses 1024 steps but the short SI-style labels. */
export function formatBytes(n: number, decimals = 1): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  let value = n
  let i = 0
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(decimals)} ${UNITS[i]}`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}
