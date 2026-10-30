/** Every flag a JavaScript RegExp accepts, in the order `RegExp.prototype.flags` prints them. */
export const REGEX_FLAGS = ['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'] as const

export type RegexFlag = (typeof REGEX_FLAGS)[number]

export const FLAG_INFO: Record<RegexFlag, { name: string; description: string }> = {
  d: { name: 'indices', description: 'Record where each capture group starts and ends' },
  g: { name: 'global', description: 'Find every match, not just the first' },
  i: { name: 'ignore case', description: 'Match letters regardless of case' },
  m: { name: 'multiline', description: '^ and $ match at line breaks, not only at the ends of the text' },
  s: { name: 'dotAll', description: '. also matches line breaks' },
  u: { name: 'unicode', description: 'Treat the pattern as code points, and enable \\p{…} and \\u{…}' },
  v: { name: 'unicodeSets', description: 'Like u, plus set operations and string properties in classes' },
  y: { name: 'sticky', description: 'Match only exactly where the last match ended' },
}

export type CompileResult =
  | { ok: true; regex: RegExp }
  | { ok: false; kind: 'flags' | 'pattern'; message: string }

/**
 * Problems with a flags string, worded for a person, or null when it is fine.
 * Checked before the engine sees it: its own messages ("Invalid flags supplied
 * to RegExp constructor") do not say which flag is wrong.
 */
export function checkFlags(flags: string): string | null {
  const seen = new Set<string>()
  for (const f of flags) {
    if (!(REGEX_FLAGS as readonly string[]).includes(f)) {
      return `Unknown flag "${f}". JavaScript has ${REGEX_FLAGS.join(', ')}.`
    }
    if (seen.has(f)) return `The flag "${f}" appears twice.`
    seen.add(f)
  }
  if (seen.has('u') && seen.has('v')) return 'The u and v flags cannot be combined: v is the newer form of u.'
  for (const f of seen) {
    try {
      void new RegExp('', f)
    } catch {
      return `This JavaScript engine does not support the "${f}" flag.`
    }
  }
  return null
}

/**
 * The engine prefixes its message with the whole pattern
 * ("Invalid regular expression: /(/: Unterminated group"), which repeats what
 * is already on screen and can run to thousands of characters.
 */
const ENGINE_PREFIX = /^Invalid regular expression: \/[\s\S]*\/[a-z]*: /

/**
 * Compiles a pattern and flags as `new RegExp(pattern, flags)` would, with
 * errors as data. Compiling never runs the pattern, so it cannot hang.
 */
export function compileRegex(pattern: string, flags: string): CompileResult {
  const flagProblem = checkFlags(flags)
  if (flagProblem !== null) return { ok: false, kind: 'flags', message: flagProblem }
  try {
    return { ok: true, regex: new RegExp(pattern, flags) }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const message = raw.replace(ENGINE_PREFIX, '')
    return { ok: false, kind: 'pattern', message: message.charAt(0).toUpperCase() + message.slice(1) }
  }
}

/**
 * Splits a pasted regex literal, `/pattern/flags`, into its parts. Null when
 * the text is not one, so it can be used as an ordinary pattern instead.
 */
export function parseRegexLiteral(text: string): { pattern: string; flags: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const close = trimmed.lastIndexOf('/')
  if (close <= 0) return null
  const flags = trimmed.slice(close + 1)
  if (!/^[a-z]*$/.test(flags)) return null
  const pattern = trimmed.slice(1, close)
  if (pattern === '') return null
  return { pattern, flags }
}

/**
 * The capture groups of a pattern in the order the engine numbers them: the
 * group's name, or null for an unnamed one. Expects a pattern that compiles.
 *
 * Needed because a match only reports names through `groups`, keyed by name,
 * which cannot tell which number a name belongs to.
 */
export function captureGroupNames(pattern: string, flags = ''): Array<string | null> {
  const names: Array<string | null> = []
  // With v, classes nest ([a[bc]]); without it, a [ inside a class is literal.
  const nested = flags.includes('v')
  let classDepth = 0
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') {
      i++
      continue
    }
    if (classDepth > 0) {
      if (c === ']') classDepth--
      else if (c === '[' && nested) classDepth++
      continue
    }
    if (c === '[') {
      classDepth = 1
      continue
    }
    if (c !== '(') continue
    if (pattern[i + 1] !== '?') {
      names.push(null)
    } else if (pattern[i + 2] === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') {
      const end = pattern.indexOf('>', i + 3)
      names.push(pattern.slice(i + 3, end))
    }
  }
  return names
}
