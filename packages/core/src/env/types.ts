/** One variable. `line` is 1-based, where its definition starts in the input. */
export interface EnvEntry {
  key: string
  value: string
  line: number
}

export type EnvSeverity = 'error' | 'warning'

/**
 * A problem tied to a line of the input. Messages name keys but never quote a
 * value: values are secrets, and the issue list stays on screen while values
 * are masked.
 */
export interface EnvIssue {
  severity: EnvSeverity
  line: number
  message: string
}

/** Unique within any issue list this module returns (exact repeats are dropped), so it can key a list. */
export function issueId(issue: EnvIssue): string {
  return `${issue.severity}:${issue.line}:${issue.message}`
}

/** What every parser returns: the variables (duplicates resolved) and what went wrong. */
export interface EnvDoc {
  entries: EnvEntry[]
  issues: EnvIssue[]
}

/**
 * The key grammar dotenv accepts. Wider than a shell identifier on purpose:
 * `.` and `-` are legal in a .env file and in `process.env`, just not in `sh`.
 */
export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/

/** A POSIX shell variable name. */
export const SHELL_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
