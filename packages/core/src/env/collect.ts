import { issueId, type EnvDoc, type EnvEntry, type EnvIssue } from './types.ts'

// Internal helpers shared by the parsers; not part of the public API.

/**
 * Collects entries with "last wins" semantics and a warning per repeat.
 *
 * A Map keeps a key at the position of its first definition while taking the
 * value of its last, which is exactly what `Object.assign`-style loaders like
 * dotenv end up with in `process.env`.
 */
export class EntryCollector {
  readonly #byKey = new Map<string, EnvEntry>()
  readonly issues: EnvIssue[] = []

  add(entry: EnvEntry): void {
    const prev = this.#byKey.get(entry.key)
    if (prev !== undefined) {
      this.issues.push({
        severity: 'warning',
        line: entry.line,
        message: `${entry.key} is already set on line ${prev.line}; this later value wins.`,
      })
    }
    this.#byKey.set(entry.key, entry)
  }

  error(line: number, message: string): void {
    this.issues.push({ severity: 'error', line, message })
  }

  warn(line: number, message: string): void {
    this.issues.push({ severity: 'warning', line, message })
  }

  done(): EnvDoc {
    return { entries: [...this.#byKey.values()], issues: sortIssues(this.issues) }
  }
}

/**
 * By line, stable, so issues read top to bottom like the input. An exact
 * repeat (`{"A": {}, "A": {}}` on one line) says nothing new, so it is dropped,
 * which also makes severity + line + message a unique key for a list.
 */
export function sortIssues(issues: readonly EnvIssue[]): EnvIssue[] {
  const seen = new Set<string>()
  return issues
    .filter((i) => {
      const id = issueId(i)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .toSorted((a, b) => a.line - b.line)
}

/** Keys are user text too; keep a pasted megabyte out of an error message. */
export function shortKey(key: string): string {
  return key.length > 40 ? `${key.slice(0, 40)}…` : key
}
