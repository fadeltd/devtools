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

/** Groups of 1-based line numbers, each group in line order, groups ordered by their first line. */
export type LineGroups = number[][]

export interface FilenameCollisions {
  /** Lines whose output names are identical: they collide on every filesystem. */
  exact: LineGroups
  /**
   * Lines whose output names differ, but only by case: separate files on Linux,
   * the same file on Windows and on a default macOS volume. A group holds every
   * line with that name, so an exact repeat inside it is listed in both.
   */
  caseOnly: LineGroups
}

export interface FilenameLinesResult {
  output: string
  summary: FilenameLinesSummary
  collisions: FilenameCollisions
}

/**
 * The key two names share when a case-insensitive filesystem treats them as
 * one. NFC first because APFS also ignores normalisation, so a composed and a
 * decomposed é are one file on a Mac. Then toLowerCase rather than full Unicode
 * case folding: NTFS and APFS compare with a one-to-one case mapping, and full
 * folding would wrongly merge "straße" with "strasse", which both keep apart.
 * JavaScript has no simple-fold primitive, and the cases where toLowerCase and
 * simple folding disagree (Greek final sigma, dotted capital İ) are rare enough
 * that a missed warning there costs less than shipping a fold table.
 */
const caseKey = (name: string) => name.normalize('NFC').toLowerCase()

/**
 * Groups `names` (one per line, `null` for a blank line) by exact name and by
 * case-insensitive key. Exported for tests and for callers that already have
 * the names; `safeFilenameLines` uses it on its own output.
 */
export function findFilenameCollisions(names: readonly (string | null)[]): FilenameCollisions {
  const exact = new Map<string, number[]>()
  const folded = new Map<string, { lines: number[]; first: string; mixed: boolean }>()
  names.forEach((name, i) => {
    if (name === null) return
    const line = i + 1
    const same = exact.get(name)
    if (same) same.push(line)
    else exact.set(name, [line])

    const key = caseKey(name)
    const group = folded.get(key)
    if (group) {
      group.lines.push(line)
      if (name !== group.first) group.mixed = true
    } else {
      folded.set(key, { lines: [line], first: name, mixed: false })
    }
  })
  // Map iteration is insertion order, so groups come out ordered by first line.
  return {
    exact: [...exact.values()].filter((g) => g.length > 1),
    caseOnly: [...folded.values()].filter((g) => g.mixed).map((g) => g.lines),
  }
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
  const names: (string | null)[] = []
  const out = doc.lines.map((line) => {
    if (isBlank(line)) {
      names.push(null)
      return ''
    }
    summary.lines++
    const { name, changed, changes } = safeFilename(line, opts)
    if (changed) summary.changed++
    summary.removedChars += changes.removedChars
    if (changes.trimmed) summary.trimmed++
    if (changes.reserved) summary.reserved++
    if (changes.truncated) summary.truncated++
    if (changes.fallback) summary.fallback++
    names.push(name)
    return name
  })
  return { output: serializeLines(withLines(doc, out)), summary, collisions: findFilenameCollisions(names) }
}
