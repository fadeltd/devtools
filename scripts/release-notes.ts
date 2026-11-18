/**
 * Write the notes of one released version from a changelog file, for creating
 * a GitHub release after the fact. Release reads the changelog as it stood at
 * that release commit (`git show <sha>:CHANGELOG.md`), so later edits never
 * leak into an older release. A site URL, when given, opens the notes.
 *
 *   pnpm exec vite-node scripts/release-notes.ts CHANGELOG.md 0.8.0 notes.md https://devtools.fadeltd.dev
 *
 * The notes go to a file, never stdout: `pnpm exec` can print its own
 * dependency check to stdout first, and that once ended up at the top of
 * every site release.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { releaseNotes } from './changelog'

const [file, version, out, siteUrl] = process.argv.slice(2)
if (file === undefined || version === undefined || out === undefined) {
  console.error('usage: release-notes.ts <changelog> <version> <out-file> [site-url]')
  process.exit(2)
}

const notes = releaseNotes(readFileSync(file, 'utf8'), version)
if (notes === null) {
  console.error(`No [${version}] section in ${file}`)
  process.exit(1)
}
writeFileSync(out, `${siteUrl === undefined ? '' : `Live at ${siteUrl}\n\n`}${notes}\n`)
