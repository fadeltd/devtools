export interface LineIndex {
  /** Character offset at which each line starts. */
  starts: Int32Array
  lineCount: number
}

export function buildLineIndex(text: string): LineIndex {
  const starts: number[] = [0]
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') starts.push(i + 1)
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      starts.push(i + 1)
    }
  }
  return { starts: Int32Array.from(starts), lineCount: starts.length }
}

/** 1-based line and column for a character offset. */
export function offsetToLineCol(
  index: LineIndex,
  offset: number,
): { line: number; column: number } {
  const { starts } = index
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 }
}

export function lineColToOffset(index: LineIndex, line: number, column: number): number {
  const start = index.starts[Math.max(0, Math.min(line - 1, index.starts.length - 1))] ?? 0
  return start + Math.max(0, column - 1)
}

export function lineText(text: string, index: LineIndex, line: number): string {
  const i = Math.max(0, Math.min(line - 1, index.starts.length - 1))
  const start = index.starts[i] ?? 0
  const end = index.starts[i + 1] ?? text.length
  return text.slice(start, end).replace(/\r?\n$/, '')
}

/**
 * Column with tabs expanded, so a caret in a monospace gutter actually lines up
 * under the offending character. Nearly every tool gets this wrong in
 * tab-indented files.
 */
export function visualColumn(line: string, column: number, tabWidth = 2): number {
  let visual = 1
  for (let i = 0; i < Math.min(column - 1, line.length); i++) {
    if (line[i] === '\t') visual += tabWidth - ((visual - 1) % tabWidth)
    else visual += 1
  }
  return visual
}
