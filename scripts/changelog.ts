/**
 * Release logic, derived from CHANGELOG.md.
 *
 * Pure and tested, because a mistake here silently ships the wrong version or
 * loses release notes, and neither is obvious from a green workflow run.
 */

export type Bump = 'major' | 'minor' | 'patch' | 'none'

export interface Unreleased {
  /** The section bodies under `## [Unreleased]`, verbatim. */
  body: string
  /** Heading names found, e.g. ['Added', 'Fixed']. */
  sections: string[]
  hasContent: boolean
}

const UNRELEASED_HEADING = /^## \[Unreleased\]\s*$/m
const ANY_RELEASE_HEADING = /^## \[\d+\.\d+\.\d+\]/m

/** Extract the Unreleased block, ignoring filler like "Nothing yet." */
export function parseUnreleased(changelog: string): Unreleased {
  const start = changelog.search(UNRELEASED_HEADING)
  if (start === -1) return { body: '', sections: [], hasContent: false }

  const afterHeading = changelog.indexOf('\n', start) + 1
  const rest = changelog.slice(afterHeading)
  const nextRelease = rest.search(ANY_RELEASE_HEADING)
  const body = (nextRelease === -1 ? rest : rest.slice(0, nextRelease)).trim()

  const sections = [...body.matchAll(/^### (.+?)\s*$/gm)].map((m) => m[1]!.trim())

  // A section heading with no bullets under it is not content.
  const hasBullets = /^[-*] /m.test(body)

  return { body, sections, hasContent: sections.length > 0 && hasBullets }
}

/**
 * Map Keep a Changelog sections to a semver bump.
 *
 * `Breaking` must be explicit — inferring a major from `Removed` would let a
 * tidy-up silently become a 1.0, which is exactly the surprise this should
 * avoid.
 */
export function determineBump(u: Unreleased): Bump {
  if (!u.hasContent) return 'none'
  const lower = u.sections.map((s) => s.toLowerCase())
  if (lower.includes('breaking') || lower.includes('breaking changes')) return 'major'
  if (lower.includes('added')) return 'minor'
  return 'patch'
}

export function parseVersion(version: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!m) throw new Error(`Not a semver version: "${version}"`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function nextVersion(current: string, bump: Bump): string {
  const [major, minor, patch] = parseVersion(current)
  switch (bump) {
    case 'major':
      // Stay in 0.x until the author decides to commit to a stable API:
      // a breaking change pre-1.0 is a minor bump by convention.
      return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    case 'none':
      return current
  }
}

export interface ReleaseResult {
  changelog: string
  version: string
  bump: Bump
  notes: string
}

/**
 * Move the Unreleased block into a dated release section and leave a fresh
 * empty Unreleased behind. Returns the new file contents; writes nothing.
 */
export function applyRelease(
  changelog: string,
  currentVersion: string,
  today: string,
): ReleaseResult | null {
  const unreleased = parseUnreleased(changelog)
  const bump = determineBump(unreleased)
  if (bump === 'none') return null

  const version = nextVersion(currentVersion, bump)

  const start = changelog.search(UNRELEASED_HEADING)
  const afterHeading = changelog.indexOf('\n', start) + 1
  const head = changelog.slice(0, afterHeading)
  const rest = changelog.slice(afterHeading)
  const nextRelease = rest.search(ANY_RELEASE_HEADING)
  const tail = nextRelease === -1 ? '' : rest.slice(nextRelease)

  const rebuilt =
    head +
    '\nNothing yet.\n\n' +
    `## [${version}] — ${today}\n\n` +
    unreleased.body +
    '\n\n' +
    tail

  return {
    changelog: rebuilt.replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n',
    version,
    bump,
    notes: unreleased.body,
  }
}
