import { FILE_HEADERS_ONLY, formatPatch, type StructuredPatchHunk } from 'diff'
import { computeDiff } from './engine'
import { splitLines } from './tokens'

const CONTEXT = 3

/** A stretch of whole lines: unchanged, or removed from A, or added in B. */
interface Segment {
  lines: readonly string[]
  added?: boolean
  removed?: boolean
}

/**
 * The exact unified diff that turns `a` into `b`, with 3 lines of context.
 *
 * Hunks come from the same line engine the view uses, so a diff the view can
 * show is a diff you can copy -- jsdiff's own `createTwoFilesPatch` runs an
 * unfiltered Myers that times out on inputs the engine handles in
 * milliseconds. jsdiff still does the formatting.
 *
 * Deliberately ignores the Ignore toggles: a patch that skipped whitespace
 * would not reproduce `b`. `null` when the line diff could not finish in time.
 */
export function toUnifiedPatch(a: string, b: string): string | null {
  const result = computeDiff(a, b, { refine: false })
  if (result === null) return null
  const hunks = toHunks(toSegments(splitLines(a), splitLines(b), result.lines))
  return formatPatch(
    { oldFileName: 'a', newFileName: 'b', oldHeader: undefined, newHeader: undefined, hunks },
    FILE_HEADERS_ONLY,
  )
}

function toSegments(linesA: readonly string[], linesB: readonly string[], runs: Int32Array): Segment[] {
  const lineA = lineIndexer(linesA)
  const lineB = lineIndexer(linesB)
  const segments: Segment[] = []
  let doneA = 0
  for (let i = 0; i < runs.length; i += 4) {
    const fromA = lineA(runs[i]!)
    const toA = lineA(runs[i + 1]!)
    const fromB = lineB(runs[i + 2]!)
    const toB = lineB(runs[i + 3]!)
    // Exact comparison, so unchanged lines are identical on both sides.
    if (fromA > doneA) segments.push({ lines: linesA.slice(doneA, fromA) })
    if (toA > fromA) segments.push({ lines: linesA.slice(fromA, toA), removed: true })
    if (toB > fromB) segments.push({ lines: linesB.slice(fromB, toB), added: true })
    doneA = toA
  }
  if (doneA < linesA.length) segments.push({ lines: linesA.slice(doneA) })
  return segments
}

/** Line index at a line-start offset. Offsets must be asked for in order. */
function lineIndexer(lines: readonly string[]): (offset: number) => number {
  let line = 0
  let pos = 0
  return (offset) => {
    while (pos < offset) pos += lines[line++]!.length
    return line
  }
}

/**
 * Group segments into hunks with `CONTEXT` lines either side, joining changes
 * whose gap is at most twice that. Mirrors jsdiff's own `structuredPatch`, so
 * the output is the shape its `formatPatch` and `applyPatch` expect.
 */
function toHunks(segments: readonly Segment[]): StructuredPatchHunk[] {
  // A trailing empty segment closes the last open hunk.
  const all: readonly Segment[] = [...segments, { lines: [] }]
  const hunks: StructuredPatchHunk[] = []
  let oldStart = 0
  let newStart = 0
  let range: string[] = []
  let oldLine = 1
  let newLine = 1

  for (let i = 0; i < all.length; i++) {
    const seg = all[i]!
    if (seg.added || seg.removed) {
      if (!oldStart) {
        oldStart = oldLine
        newStart = newLine
        const prev = all[i - 1]
        range = prev ? prev.lines.slice(-CONTEXT).map((l) => ' ' + l) : []
        oldStart -= range.length
        newStart -= range.length
      }
      for (const line of seg.lines) range.push((seg.added ? '+' : '-') + line)
      if (seg.added) newLine += seg.lines.length
      else oldLine += seg.lines.length
      continue
    }

    if (oldStart) {
      if (seg.lines.length <= CONTEXT * 2 && i < all.length - 2) {
        for (const line of seg.lines) range.push(' ' + line)
      } else {
        const tail = Math.min(seg.lines.length, CONTEXT)
        for (const line of seg.lines.slice(0, tail)) range.push(' ' + line)
        hunks.push({
          oldStart,
          oldLines: oldLine - oldStart + tail,
          newStart,
          newLines: newLine - newStart + tail,
          lines: range,
        })
        oldStart = 0
        newStart = 0
        range = []
      }
    }
    oldLine += seg.lines.length
    newLine += seg.lines.length
  }

  // Lines were kept with their terminators; drop the `\n` and mark any line
  // that had none, which can only be the last line of its file.
  for (const hunk of hunks) {
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i]!
      if (line.endsWith('\n')) {
        hunk.lines[i] = line.slice(0, -1)
      } else {
        hunk.lines.splice(i + 1, 0, '\\ No newline at end of file')
        i++
      }
    }
  }
  return hunks
}
