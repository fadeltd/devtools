export type NoteCode =
  | 'big-integer'
  | 'mixed-types'
  | 'always-null'
  | 'empty-array'
  | 'field-collision'
  | 'bad-go-tag'
  | 'depth'
  | 'more'

/** Something the output does that the user should know, with where it applies. */
export interface TypeNote {
  code: NoteCode
  message: string
  /** jq-style path (`.users[].id`), or null when it applies to the whole input. */
  path: string | null
}

/** Past this many, one summary note replaces the rest. */
export const MAX_NOTES = 100

export interface NoteSink {
  add(code: NoteCode, path: string | null, message: string): void
  list(): TypeNote[]
}

/** Drops exact repeats (a shared type is reached from several places). */
export function noteSink(): NoteSink {
  const seen = new Set<string>()
  const notes: TypeNote[] = []
  let dropped = 0
  return {
    add(code, rawPath, message) {
      // Paths are built by appending `.key` and `[]`; only the root, and a
      // root array, lack the leading dot jq writes.
      const path = rawPath === null || rawPath.startsWith(".") ? rawPath : `.${rawPath}`
      const key = `${code}\u0000${path}\u0000${message}`
      if (seen.has(key)) return
      seen.add(key)
      if (notes.length < MAX_NOTES) notes.push({ code, path, message })
      else dropped++
    },
    list() {
      if (dropped === 0) return notes
      return [...notes, { code: 'more', path: null, message: `…and ${dropped} more notes like these.` }]
    },
  }
}
