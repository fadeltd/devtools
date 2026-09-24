import { describe, expect, it } from 'vitest'
import {
  applyRelease,
  determineBump,
  nextVersion,
  parseUnreleased,
  parseVersion,
} from './changelog'

const doc = (unreleased: string, rest = '## [0.1.0] — 2026-01-01\n\n### Added\n- first\n') =>
  `# Changelog\n\nBlurb.\n\n## [Unreleased]\n\n${unreleased}\n\n${rest}`

describe('parseUnreleased', () => {
  it('finds sections and bullets', () => {
    const u = parseUnreleased(doc('### Added\n- a thing\n\n### Fixed\n- a bug'))
    expect(u.sections).toEqual(['Added', 'Fixed'])
    expect(u.hasContent).toBe(true)
  })

  it('treats filler as no content', () => {
    expect(parseUnreleased(doc('Nothing yet.')).hasContent).toBe(false)
  })

  it('treats a heading with no bullets as no content', () => {
    expect(parseUnreleased(doc('### Added')).hasContent).toBe(false)
  })

  it('does not run past the next release heading', () => {
    const u = parseUnreleased(doc('### Fixed\n- mine'))
    expect(u.body).not.toContain('first')
    expect(u.sections).toEqual(['Fixed'])
  })

  it('handles a changelog with no Unreleased section', () => {
    const u = parseUnreleased('# Changelog\n\n## [0.1.0] — 2026-01-01\n')
    expect(u.hasContent).toBe(false)
  })
})

const bumpOf = (body: string) => determineBump(parseUnreleased(doc(body)))

describe('determineBump', () => {
  it('is none when there is nothing to release', () => {
    expect(bumpOf('Nothing yet.')).toBe('none')
  })

  it('is minor for Added', () => {
    expect(bumpOf('### Added\n- feature')).toBe('minor')
  })

  it('is patch for Fixed, Changed or Security alone', () => {
    expect(bumpOf('### Fixed\n- bug')).toBe('patch')
    expect(bumpOf('### Changed\n- tweak')).toBe('patch')
    expect(bumpOf('### Security\n- hardening')).toBe('patch')
  })

  it('is major only when Breaking is explicit', () => {
    expect(bumpOf('### Breaking\n- dropped an API')).toBe('major')
    // Removed must NOT imply major: a tidy-up should not force a 1.0.
    expect(bumpOf('### Removed\n- dead code')).toBe('patch')
  })

  it('takes the highest applicable bump', () => {
    expect(bumpOf('### Fixed\n- bug\n\n### Added\n- feature')).toBe('minor')
    expect(bumpOf('### Added\n- feature\n\n### Breaking\n- gone')).toBe('major')
  })
})

describe('nextVersion', () => {
  it('bumps each component', () => {
    expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  it('keeps 0.x pre-stable: a breaking change is a minor bump', () => {
    expect(nextVersion('0.4.2', 'major')).toBe('0.5.0')
  })

  it('returns the current version for no bump', () => {
    expect(nextVersion('1.2.3', 'none')).toBe('1.2.3')
  })

  it('rejects non-semver input rather than guessing', () => {
    expect(() => parseVersion('1.2')).toThrow()
    expect(() => parseVersion('v1.2.3')).toThrow()
  })
})

describe('applyRelease', () => {
  const today = '2026-09-24'

  it('returns null when there is nothing to release', () => {
    expect(applyRelease(doc('Nothing yet.'), '0.1.0', today)).toBeNull()
  })

  it('moves Unreleased into a dated section and computes the version', () => {
    const r = applyRelease(doc('### Added\n- a feature'), '0.1.0', today)
    expect(r).not.toBeNull()
    expect(r!.version).toBe('0.2.0')
    expect(r!.bump).toBe('minor')
    expect(r!.changelog).toContain(`## [0.2.0] — ${today}`)
    expect(r!.changelog).toContain('- a feature')
  })

  it('leaves a fresh empty Unreleased behind', () => {
    const r = applyRelease(doc('### Fixed\n- bug'), '0.1.0', today)!
    expect(parseUnreleased(r.changelog).hasContent).toBe(false)
    expect(r.changelog).toMatch(/## \[Unreleased\]\s*\n\s*Nothing yet\./)
  })

  it('preserves earlier releases', () => {
    const r = applyRelease(doc('### Fixed\n- bug'), '0.1.0', today)!
    expect(r.changelog).toContain('## [0.1.0] — 2026-01-01')
    expect(r.changelog).toContain('- first')
  })

  it('orders the new release above the previous one', () => {
    const r = applyRelease(doc('### Added\n- x'), '0.1.0', today)!
    expect(r.changelog.indexOf('## [0.2.0]')).toBeLessThan(r.changelog.indexOf('## [0.1.0]'))
  })

  it('returns the notes for the release body', () => {
    const r = applyRelease(doc('### Added\n- a feature'), '0.1.0', today)!
    expect(r.notes).toContain('- a feature')
    expect(r.notes).not.toContain('first')
  })

  it('is idempotent: running it again releases nothing', () => {
    const first = applyRelease(doc('### Added\n- x'), '0.1.0', today)!
    expect(applyRelease(first.changelog, first.version, today)).toBeNull()
  })

  it('does not leave runs of blank lines', () => {
    const r = applyRelease(doc('### Added\n- x'), '0.1.0', today)!
    expect(r.changelog).not.toMatch(/\n{4,}/)
  })
})
