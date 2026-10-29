/**
 * List Tailwind classes in src/ that have a canonical spelling, and rewrite
 * them with --write. The test in tailwind.test.ts fails CI on any that remain.
 *
 *   pnpm tw:fix            # report
 *   pnpm tw:fix --write    # rewrite in place
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFindings, findNonCanonical } from './tailwind'

const findings = await findNonCanonical()
for (const f of findings) console.log(`${f.file}:${f.line}:${f.column}  ${f.from} → ${f.to}`)

if (process.argv.includes('--write')) {
  const byFile = new Map<string, typeof findings>()
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f])
  for (const [file, list] of byFile) {
    const path = join(import.meta.dirname, '..', file)
    writeFileSync(path, applyFindings(readFileSync(path, 'utf8'), list))
  }
  console.log(`tw:fix: rewrote ${findings.length} classes in ${byFile.size} files`)
} else {
  console.log(`tw:fix: ${findings.length} non-canonical classes${findings.length > 0 ? ' (run with --write)' : ''}`)
}
