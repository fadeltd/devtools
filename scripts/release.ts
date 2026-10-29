/**
 * Cut a release from a changelog: the site's CHANGELOG.md by default, or
 * @fadeltd/devtools-core's with --changelog/--package/--tag-prefix.
 *
 * Reads the Unreleased section, decides the semver bump from its headings,
 * rewrites CHANGELOG.md and package.json, and prints the outcome for the
 * workflow to consume. Writes files but never touches git — the workflow owns
 * committing, tagging and pushing, so this stays runnable locally as a dry run.
 *
 *   pnpm exec vite-node scripts/release.ts --dry-run
 *   pnpm exec vite-node scripts/release.ts --changelog packages/core/CHANGELOG.md \
 *     --package packages/core/package.json --tag-prefix core-v --dry-run
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { applyRelease, parseReleaseArgs } from './changelog'

const { changelogPath, packagePath, tagPrefix, dryRun } = parseReleaseArgs(process.argv.slice(2))

const changelog = readFileSync(changelogPath, 'utf8')
const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string }
const today = new Date().toISOString().slice(0, 10)

const result = applyRelease(changelog, pkg.version, today)

function emit(key: string, value: string): void {
  const out = process.env.GITHUB_OUTPUT
  if (out) appendFileSync(out, `${key}=${value}\n`)
}

if (!result) {
  console.log('Nothing under [Unreleased] — no release.')
  emit('released', 'false')
  process.exit(0)
}

console.log(`bump    : ${result.bump}`)
console.log(`version : ${pkg.version} -> ${result.version}`)
console.log(`tag     : ${tagPrefix}${result.version}`)

if (dryRun) {
  console.log('\n--- notes ---')
  console.log(result.notes)
  console.log('\n(dry run: no files written)')
  process.exit(0)
}

writeFileSync(changelogPath, result.changelog)
writeFileSync(packagePath, JSON.stringify({ ...pkg, version: result.version }, null, 2) + '\n')

emit('released', 'true')
emit('version', result.version)
emit('tag', `${tagPrefix}${result.version}`)

console.log(`\n${changelogPath} and ${packagePath} updated.`)
