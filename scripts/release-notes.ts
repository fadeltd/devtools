/**
 * Print the notes of one released version from a changelog file, for creating
 * a GitHub release after the fact. Release reads the changelog as it stood at
 * that release commit (`git show <sha>:CHANGELOG.md`), so later edits never
 * leak into an older release.
 *
 *   pnpm exec vite-node scripts/release-notes.ts CHANGELOG.md 0.8.0
 */
import { readFileSync } from 'node:fs'
import { releaseNotes } from './changelog'

const [file, version] = process.argv.slice(2)
if (file === undefined || version === undefined) {
  console.error('usage: release-notes.ts <changelog> <version>')
  process.exit(2)
}

const notes = releaseNotes(readFileSync(file, 'utf8'), version)
if (notes === null) {
  console.error(`No [${version}] section in ${file}`)
  process.exit(1)
}
console.log(notes)
