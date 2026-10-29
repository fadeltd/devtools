import { isBlank, parseLines, serializeLines, withLines } from '../list/lines.ts'
import { safeFilename, type FilenameOptions } from './filename.ts'
import { slugify, type SlugOptions } from './slugify.ts'

export interface SlugLinesResult {
  output: string
  /** Non-blank input lines. */
  lines: number
  /** Non-blank lines that had nothing sluggable in them (all emoji, say). */
  empty: number
}

export interface FilenameLinesSummary {
  /** Non-blank input lines. */
  lines: number
  /** Lines whose output differs from the input. */
  changed: number
  removedChars: number
  trimmed: number
  reserved: number
  truncated: number
  fallback: number
}

export interface FilenameLinesResult {
  output: string
  summary: FilenameLinesSummary
}

/**
 * Both bulk modes keep blank lines blank rather than turning them into a
 * fallback name, so output line N always belongs to input line N. Line endings,
 * a BOM and the trailing newline survive via the list helpers.
 */
export function slugifyLines(text: string, opts: Partial<SlugOptions> = {}): SlugLinesResult {
  const doc = parseLines(text)
  let lines = 0
  let empty = 0
  const out = doc.lines.map((line) => {
    if (isBlank(line)) return ''
    lines++
    const slug = slugify(line, opts)
    if (slug === '') empty++
    return slug
  })
  return { output: serializeLines(withLines(doc, out)), lines, empty }
}

export function safeFilenameLines(
  text: string,
  opts: Partial<FilenameOptions> = {},
): FilenameLinesResult {
  const doc = parseLines(text)
  const summary: FilenameLinesSummary = {
    lines: 0,
    changed: 0,
    removedChars: 0,
    trimmed: 0,
    reserved: 0,
    truncated: 0,
    fallback: 0,
  }
  const out = doc.lines.map((line) => {
    if (isBlank(line)) return ''
    summary.lines++
    const { name, changed, changes } = safeFilename(line, opts)
    if (changed) summary.changed++
    summary.removedChars += changes.removedChars
    if (changes.trimmed) summary.trimmed++
    if (changes.reserved) summary.reserved++
    if (changes.truncated) summary.truncated++
    if (changes.fallback) summary.fallback++
    return name
  })
  return { output: serializeLines(withLines(doc, out)), summary }
}
