/**
 * CI check for a pull request: fail if the merge would put any of the PR's
 * [Unreleased] entries inside an already released section (see
 * `misplacedEntries`). The fix is to merge or rebase main into the branch and
 * move the entries back under [Unreleased].
 *
 * Runs on the merge commit GitHub builds for a PR, whose parents are the base
 * and the PR head. Pass refs explicitly to try it on any merge:
 *
 *   pnpm exec vite-node scripts/check-changelog.ts --base <sha> --head <sha> --merged <sha>
 */
import { execFileSync } from 'node:child_process'
import { misplacedEntries } from './changelog'

const CHANGELOGS = ['CHANGELOG.md', 'packages/core/CHANGELOG.md']

const argv = process.argv.slice(2)
const ref = (flag: string, fallback: string): string => {
  const i = argv.indexOf(flag)
  return i === -1 ? fallback : argv[i + 1]!
}
const base = ref('--base', 'HEAD^1')
const head = ref('--head', 'HEAD^2')
const merged = ref('--merged', 'HEAD')

function show(rev: string, path: string): string {
  try {
    return execFileSync('git', ['show', `${rev}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    // Not there at that revision: nothing released, nothing added.
    return ''
  }
}

let failed = false
for (const path of CHANGELOGS) {
  const lines = misplacedEntries(show(base, path), show(merged, path), show(head, path))
  for (const line of lines) {
    failed = true
    console.log(
      `::error file=${path}::This entry would land in an already released section, so the merge would release nothing: ${line}`,
    )
  }
}

if (failed) {
  console.log(
    'A release landed on main after this branch was cut. Merge or rebase main, then move the entries back under ## [Unreleased].',
  )
  process.exit(1)
}
console.log('Changelog entries are all under [Unreleased].')
