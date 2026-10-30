import { captureGroupNames } from './compile.ts'

export interface ReplaceResult {
  output: string
  /** How many matches were replaced. */
  count: number
}

/**
 * `text.replace(regex, template)`, exactly, plus a count of replacements.
 *
 * The template is expanded by `expandTemplate`, a copy of the language's own
 * rules, because a replacer function is the only way to count and it loses
 * the `$1` / `$<name>` handling of a template string.
 *
 * This runs the user's pattern: call it in a worker.
 */
export function replaceWith(text: string, regex: RegExp, template: string): ReplaceResult {
  const groups = captureGroupNames(regex.source, regex.flags).length
  let count = 0
  const re = new RegExp(regex)
  const output = text.replace(re, (...args: unknown[]) => {
    count++
    const captures = args.slice(1, 1 + groups) as Array<string | undefined>
    const position = args[1 + groups] as number
    const named = args[3 + groups] as Record<string, string | undefined> | undefined
    return expandTemplate(template, args[0] as string, text, position, captures, named)
  })
  return { output, count }
}

/**
 * The language's GetSubstitution: `$$`, `$&`, `` $` ``, `$'`, `$1`–`$99` and
 * `$<name>`, with every edge it defines (`$0` and a number past the last group
 * stay as written; `$10` falls back to `$1` then "0" when there are fewer than
 * ten groups; `$<name>` is literal when the pattern has no named groups).
 */
export function expandTemplate(
  template: string,
  matched: string,
  str: string,
  position: number,
  captures: ReadonlyArray<string | undefined>,
  named: Readonly<Record<string, string | undefined>> | undefined,
): string {
  let out = ''
  let i = 0
  while (i < template.length) {
    const dollar = template.indexOf('$', i)
    if (dollar === -1 || dollar === template.length - 1) {
      out += template.slice(i)
      break
    }
    out += template.slice(i, dollar)
    const next = template[dollar + 1]!
    if (next === '$') {
      out += '$'
      i = dollar + 2
    } else if (next === '&') {
      out += matched
      i = dollar + 2
    } else if (next === '`') {
      out += str.slice(0, position)
      i = dollar + 2
    } else if (next === "'") {
      out += str.slice(Math.min(position + matched.length, str.length))
      i = dollar + 2
    } else if (isDigit(next)) {
      const ref = numberedRef(template, dollar, captures.length)
      out += ref.group === null ? template.slice(dollar, dollar + ref.length) : (captures[ref.group - 1] ?? '')
      i = dollar + ref.length
    } else if (next === '<') {
      const close = named === undefined ? -1 : template.indexOf('>', dollar + 2)
      if (close === -1) {
        out += '$<'
        i = dollar + 2
      } else {
        out += named![template.slice(dollar + 2, close)] ?? ''
        i = close + 1
      }
    } else {
      out += '$'
      i = dollar + 1
    }
  }
  return out
}

/** `$n` or `$nn` at `dollar`: its length and the group it names, or null when it stays as written. */
function numberedRef(template: string, dollar: number, groups: number): { length: number; group: number | null } {
  const twoDigits = isDigit(template[dollar + 2])
  let length = twoDigits ? 3 : 2
  let index = Number(template.slice(dollar + 1, dollar + length))
  if (index > groups && length === 3) {
    length = 2
    index = Number(template[dollar + 1])
  }
  return { length, group: index >= 1 && index <= groups ? index : null }
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9'
}

export interface ReplacementIssue {
  /** The reference as written in the template. */
  ref: string
  message: string
}

/**
 * References in a replacement template that do not do what they look like
 * they do. Each is legal, so JavaScript never complains; it silently inserts
 * the reference as written, or nothing.
 */
export function replacementIssues(template: string, groupNames: ReadonlyArray<string | null>): ReplacementIssue[] {
  const groups = groupNames.length
  const names = new Set(groupNames.filter((n): n is string => n !== null))
  const issues = new Map<string, string>()

  for (let i = 0; i < template.length; i++) {
    const c = template[i]
    if (c === '\\' && isDigit(template[i + 1]) && template[i + 1] !== '0') {
      const ref = template.slice(i, i + 2)
      issues.set(ref, `${ref} is inserted as written: JavaScript replacements use $${template[i + 1]}.`)
      continue
    }
    if (c !== '$' || i === template.length - 1) continue
    const next = template[i + 1]!
    if (next === '$') {
      i++
    } else if (isDigit(next)) {
      const ref = numberedRef(template, i, groups)
      const written = template.slice(i, i + ref.length)
      if (ref.group === null) {
        issues.set(
          written,
          Number(written.slice(1)) === 0
            ? `${written} is inserted as written: there is no group 0. Use $& for the whole match.`
            : `${written} is inserted as written: the pattern has ${groups === 0 ? 'no capture groups' : groups === 1 ? '1 capture group' : `${groups} capture groups`}.`,
        )
      }
      i += ref.length - 1
    } else if (next === '<') {
      const close = template.indexOf('>', i + 2)
      if (names.size === 0) {
        const ref = close === -1 ? '$<' : template.slice(i, close + 1)
        issues.set(ref, `${ref} is inserted as written: the pattern has no named groups.`)
      } else if (close === -1) {
        issues.set('$<', '$< has no closing >, so it is inserted as written.')
      } else {
        const name = template.slice(i + 2, close)
        if (!names.has(name)) {
          issues.set(template.slice(i, close + 1), `$<${name}> inserts nothing: no group is named "${name}".`)
        }
        i = close
      }
    }
  }
  return [...issues].map(([ref, message]) => ({ ref, message }))
}
