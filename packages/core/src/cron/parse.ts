/**
 * A hand-written parser for standard (Vixie) cron expressions: five fields,
 * or six with seconds first, plus the `@` macros.
 *
 * Hand-written rather than borrowed because the point of the tool is to say
 * exactly where an expression is wrong, and to refuse the Quartz dialect by
 * name instead of half-accepting it: `?`, `L`, `W` and `#` mean something to
 * Quartz and Spring, and nothing to crond.
 */

export type FieldName = 'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

export type CronErrorCode =
  | 'empty'
  | 'field-count'
  | 'quartz'
  | 'syntax'
  | 'out-of-range'
  | 'range'
  | 'step'
  | 'name'
  | 'macro'

export interface CronError {
  code: CronErrorCode
  message: string
  /** The field the problem is in, or null when it is about the whole expression. */
  field: FieldName | null
  /** 0-based UTF-16 offset into the original input. */
  position: number
}

interface FieldSpec {
  name: FieldName
  label: string
  min: number
  max: number
  /** Upper bound for `*` and open-ended `a/step`, which differs from `max` only for day of week (7 = Sunday again). */
  top: number
  singular: string
  plural: string
  names?: readonly string[]
  /** Offset of `names[0]`: months count from 1, weekdays from 0. */
  nameBase?: number
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

const SPECS: Record<FieldName, FieldSpec> = {
  second: { name: 'second', label: 'Second', min: 0, max: 59, top: 59, singular: 'second', plural: 'seconds' },
  minute: { name: 'minute', label: 'Minute', min: 0, max: 59, top: 59, singular: 'minute', plural: 'minutes' },
  hour: { name: 'hour', label: 'Hour', min: 0, max: 23, top: 23, singular: 'hour', plural: 'hours' },
  dayOfMonth: { name: 'dayOfMonth', label: 'Day of month', min: 1, max: 31, top: 31, singular: 'day', plural: 'days' },
  month: {
    name: 'month', label: 'Month', min: 1, max: 12, top: 12, singular: 'month', plural: 'months',
    names: MONTH_NAMES, nameBase: 1,
  },
  dayOfWeek: {
    name: 'dayOfWeek', label: 'Day of week', min: 0, max: 7, top: 6, singular: 'day of the week', plural: 'days of the week',
    names: WEEKDAY_NAMES, nameBase: 0,
  },
}

export function fieldLabel(name: FieldName): string {
  return SPECS[name].label
}

const FIVE: readonly FieldName[] = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek']
const SIX: readonly FieldName[] = ['second', ...FIVE]

export type CronItem =
  | { kind: 'star'; step: number }
  | { kind: 'single'; value: number }
  | { kind: 'range'; from: number; to: number; step: number }
  /** `a/step`: from `a` to the top of the field. Vixie rejects it; cronie and every describer accept it. */
  | { kind: 'start'; from: number; step: number }

export interface CronField {
  name: FieldName
  label: string
  /** The field exactly as written. */
  text: string
  /** 0-based offset of the field in the input; -1 for a field expanded from a macro. */
  start: number
  items: CronItem[]
  /** Sorted, distinct; day of week 7 is folded to 0. */
  values: number[]
  /**
   * Vixie's `*_STAR` flag: the field text starts with `*`. Note this is true
   * for `*\/2` as well, which matters for the day-of-month/day-of-week rule.
   */
  star: boolean
  /** Plain-English reading of this field alone. */
  meaning: string
}

export interface CronSchedule {
  kind: 'schedule'
  /** The trimmed input. */
  source: string
  /** `@daily` and friends, lowercased, or null. */
  macro: string | null
  /** The 5- or 6-field form: the macro's expansion, or the input with whitespace normalised. */
  expression: string
  hasSeconds: boolean
  fields: CronField[]
  /** Lookup tables for the matcher, indexed by value. */
  match: Record<FieldName, readonly boolean[]>
  /** Day of month and day of week are both restricted, so either one matching is enough. */
  dayOr: boolean
  /** Readings that are valid cron but easy to misjudge, in plain English. */
  notes: string[]
}

export interface RebootSchedule {
  kind: 'reboot'
  source: string
  macro: '@reboot'
}

export type CronParseResult =
  | { ok: true; value: CronSchedule | RebootSchedule }
  | { ok: false; error: CronError }

export const MACROS: Readonly<Record<string, string>> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

class Fail {
  constructor(readonly error: CronError) {}
}

function fail(code: CronErrorCode, field: FieldName | null, position: number, message: string): never {
  // Thrown only inside this module and caught in parseCron: the public API
  // returns errors as data.
  throw new Fail({ code, field, position, message })
}

const QUARTZ_HINTS: Readonly<Record<string, string>> = {
  '?': '"?" means "no specific value"; use * instead',
  L: '"L" means "last"; standard cron has no last-day syntax',
  W: '"W" means "nearest weekday"; standard cron has no equivalent',
  '#': '"#" means "nth weekday of the month"; standard cron has no equivalent',
}

function quartz(spec: FieldSpec, position: number, symbol: string): never {
  fail(
    'quartz',
    spec.name,
    position,
    `Quartz syntax isn't standard cron: ${QUARTZ_HINTS[symbol] ?? `"${symbol}"`} (${spec.label.toLowerCase()} field).`,
  )
}

// `L`, `LW`, `L-3`, `15W`, `5L`, `FRIL`: the Quartz forms built from letters,
// which would otherwise fall through to a confusing "unknown name" error.
const QUARTZ_LETTERS = /^(?:L|LW|L-\d+|\d+[LW]|\d*L|[A-Z]{3}L)$/i

function parseAtom(spec: FieldSpec, text: string, at: number): number {
  if (text === '') fail('syntax', spec.name, at, `Expected a number in the ${spec.label.toLowerCase()} field.`)
  if (/^\d+$/.test(text)) {
    const n = Number(text)
    if (n < spec.min || n > spec.max) {
      fail('out-of-range', spec.name, at, `${spec.label} ${text} is out of range (${spec.min}–${spec.max}).`)
    }
    return n
  }
  if (/^[A-Za-z]+$/.test(text)) {
    const upper = text.toUpperCase()
    if (spec.names !== undefined && spec.nameBase !== undefined) {
      const i = spec.names.findIndex((n) => n.slice(0, 3).toUpperCase() === upper)
      if (i >= 0) return i + spec.nameBase
    }
    if (QUARTZ_LETTERS.test(text)) quartz(spec, at + upper.search(/[LW]/), upper.includes('W') ? 'W' : 'L')
    if (spec.names === undefined) {
      fail('name', spec.name, at, `Names like "${text}" are only allowed in the month and day-of-week fields.`)
    }
    const examples = spec.name === 'month' ? 'JAN–DEC' : 'SUN–SAT'
    fail('name', spec.name, at, `Unknown ${spec.label.toLowerCase()} name "${text}"; use three letters (${examples}).`)
  }
  if (QUARTZ_LETTERS.test(text)) quartz(spec, at + text.toUpperCase().search(/[LW]/), /W/i.test(text) ? 'W' : 'L')
  const bad = text.search(/[^0-9A-Za-z]/)
  const offset = bad < 0 ? 0 : bad
  fail('syntax', spec.name, at + offset, `Unexpected "${text[offset] ?? text}" in the ${spec.label.toLowerCase()} field.`)
}

function parseStep(spec: FieldSpec, text: string, at: number): number {
  if (!/^\d+$/.test(text)) {
    fail('step', spec.name, at, `A step must be a whole number, as in */5 (${spec.label.toLowerCase()} field).`)
  }
  const n = Number(text)
  if (n === 0) fail('step', spec.name, at, `A step of 0 never advances (${spec.label.toLowerCase()} field).`)
  return n
}

function parseItem(spec: FieldSpec, text: string, at: number): CronItem {
  const slash = text.indexOf('/')
  const base = slash < 0 ? text : text.slice(0, slash)
  let step = 1
  if (slash >= 0) {
    const rest = text.slice(slash + 1)
    if (rest.includes('/')) fail('syntax', spec.name, at + slash + 1 + rest.indexOf('/'), `Only one "/" is allowed per list item.`)
    step = parseStep(spec, rest, at + slash + 1)
    if (base === '') fail('syntax', spec.name, at, `A step needs something to step through, as in */${rest} or 0-30/${rest}.`)
  }
  if (base === '*') return { kind: 'star', step }

  const dash = base.indexOf('-', 1)
  // `L-3` is Quartz; catch it before the dash splits it.
  if (QUARTZ_LETTERS.test(base)) quartz(spec, at + base.toUpperCase().search(/[LW]/), /W/i.test(base) ? 'W' : 'L')
  if (dash < 0) {
    const value = parseAtom(spec, base, at)
    return slash < 0 ? { kind: 'single', value } : { kind: 'start', from: value, step }
  }
  const from = parseAtom(spec, base.slice(0, dash), at)
  const toText = base.slice(dash + 1)
  let to = parseAtom(spec, toText, at + dash + 1)
  // MON-SUN reads naturally, but SUN is 0; treat a named Sunday at the end of a
  // range as 7, which cron already accepts as Sunday.
  if (spec.name === 'dayOfWeek' && to === 0 && from > 0 && /^[A-Za-z]+$/.test(toText)) to = 7
  if (to < from) {
    fail('range', spec.name, at, `The range ${base} runs backwards; cron ranges don't wrap around.`)
  }
  return { kind: 'range', from, to, step }
}

function expand(spec: FieldSpec, item: CronItem): number[] {
  let from: number
  let to: number
  let step = 1
  switch (item.kind) {
    case 'star':
      ;[from, to, step] = [spec.min, spec.top, item.step]
      break
    case 'single':
      ;[from, to] = [item.value, item.value]
      break
    case 'range':
      ;[from, to, step] = [item.from, item.to, item.step]
      break
    case 'start':
      ;[from, to, step] = [item.from, Math.max(item.from, spec.top), item.step]
      break
  }
  const out: number[] = []
  for (let v = from; v <= to; v += step) out.push(spec.name === 'dayOfWeek' && v === 7 ? 0 : v)
  return out
}

function valueName(spec: FieldSpec, v: number): string {
  if (spec.names !== undefined && spec.nameBase !== undefined) {
    return spec.names[(v - spec.nameBase) % spec.names.length] ?? String(v)
  }
  return String(v)
}

function describeItem(spec: FieldSpec, item: CronItem): string {
  const named = spec.names !== undefined
  const one = (v: number) => (named ? valueName(spec, v) : `${spec.singular} ${v}`)
  const every = (step: number) => (step === 1 ? `every ${spec.singular}` : `every ${step} ${spec.plural}`)
  switch (item.kind) {
    case 'star':
      return every(item.step)
    case 'single':
      return one(item.value)
    case 'range': {
      const span = `${named ? valueName(spec, item.from) : item.from} through ${named ? valueName(spec, item.to) : item.to}`
      return item.step === 1 ? (named ? span : `${spec.plural} ${span}`) : `${every(item.step)} from ${span}`
    }
    case 'start':
      return `${every(item.step)} starting at ${named ? valueName(spec, item.from) : item.from}`
  }
}

function parseField(spec: FieldSpec, text: string, start: number): CronField {
  for (const symbol of ['?', '#']) {
    const i = text.indexOf(symbol)
    if (i >= 0) quartz(spec, start + i, symbol)
  }
  const items: CronItem[] = []
  let offset = 0
  for (const part of text.split(',')) {
    if (part === '') {
      fail('syntax', spec.name, start + offset, `Empty list item in the ${spec.label.toLowerCase()} field.`)
    }
    items.push(parseItem(spec, part, start + offset))
    offset += part.length + 1
  }
  const values = [...new Set(items.flatMap((item) => expand(spec, item)))].toSorted((a, b) => a - b)
  return {
    name: spec.name,
    label: spec.label,
    text,
    start,
    items,
    values,
    star: text.startsWith('*'),
    meaning: items.map((item) => describeItem(spec, item)).join(', '),
  }
}

function table(spec: FieldSpec, values: readonly number[]): boolean[] {
  const t = Array.from({ length: spec.max + 1 }, () => false)
  for (const v of values) t[v] = true
  return t
}

interface Token {
  text: string
  start: number
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  for (const m of input.matchAll(/\S+/g)) tokens.push({ text: m[0], start: m.index })
  return tokens
}

const ZERO_SECONDS: readonly boolean[] = Array.from({ length: 60 }, (_, i) => i === 0)

function build(source: string, macro: string | null, tokens: readonly Token[], fromMacro: boolean): CronSchedule {
  const names = tokens.length === 6 ? SIX : FIVE
  const fields = tokens.map((t, i) => {
    const name = names[i] as FieldName
    return parseField(SPECS[name], t.text, fromMacro ? -1 : t.start)
  })
  const byName = Object.fromEntries(fields.map((f) => [f.name, f])) as Partial<Record<FieldName, CronField>>
  const get = (name: FieldName) => byName[name] as CronField
  const hasSeconds = byName.second !== undefined
  const dom = get('dayOfMonth')
  const dow = get('dayOfWeek')
  const dayOr = !dom.star && !dow.star
  return {
    kind: 'schedule',
    source,
    macro,
    expression: tokens.map((t) => t.text).join(' '),
    hasSeconds,
    fields,
    match: {
      second: hasSeconds ? table(SPECS.second, get('second').values) : ZERO_SECONDS,
      minute: table(SPECS.minute, get('minute').values),
      hour: table(SPECS.hour, get('hour').values),
      dayOfMonth: table(SPECS.dayOfMonth, get('dayOfMonth').values),
      month: table(SPECS.month, get('month').values),
      dayOfWeek: table(SPECS.dayOfWeek, get('dayOfWeek').values),
    },
    // Vixie decides by the first character, not by the resulting set: `*/2`
    // counts as unrestricted, so `0 0 */2 * MON` needs both to match.
    dayOr,
    notes: notesFor(fields, dom, dow, dayOr),
  }
}

function notesFor(fields: readonly CronField[], dom: CronField, dow: CronField, dayOr: boolean): string[] {
  const notes: string[] = []
  if (dayOr) {
    notes.push(
      'Day of month and day of week are both restricted, so cron runs on any day that matches either one, not only days that match both.',
    )
  } else if (dom.text !== '*' && dow.text !== '*') {
    const starred = dom.star ? dom : dow
    notes.push(
      `${starred.label} starts with "*", so cron counts it as unrestricted and runs only on days that match both day fields.`,
    )
  }
  for (const field of fields) {
    const spec = SPECS[field.name]
    for (const item of field.items) {
      if (item.kind === 'single' || item.step === 1) continue
      const hits = expand(spec, item)
      if (hits.length !== 1) continue
      // `*/90` reads as "every 90 minutes", but steps restart at each field
      // boundary, so it is only ever minute 0.
      notes.push(
        `A step of ${item.step} only matches ${field.label.toLowerCase()} ${valueName(spec, hits[0] as number)}: steps restart every ${parentUnit(field.name)}, so this is not "every ${item.step} ${spec.plural}".`,
      )
    }
  }
  return notes
}

function parentUnit(name: FieldName): string {
  switch (name) {
    case 'second':
      return 'minute'
    case 'minute':
      return 'hour'
    case 'hour':
      return 'day'
    case 'dayOfMonth':
      return 'month'
    case 'month':
      return 'year'
    case 'dayOfWeek':
      return 'week'
  }
}

/** Parse a cron expression. Never throws: errors come back with their field and position. */
export function parseCron(input: string): CronParseResult {
  try {
    return { ok: true, value: parseOrThrow(input) }
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.error }
    throw e
  }
}

function parseOrThrow(input: string): CronSchedule | RebootSchedule {
  const tokens = tokenize(input)
  const source = input.trim()
  const first = tokens[0]
  if (first === undefined) fail('empty', null, 0, 'Enter a cron expression, such as */15 * * * *.')

  if (first.text.startsWith('@')) {
    const macro = first.text.toLowerCase()
    const extra = tokens[1]
    if (extra !== undefined) {
      fail('field-count', null, extra.start, `${first.text} stands alone; remove what follows it (a crontab command goes elsewhere).`)
    }
    if (macro === '@reboot') return { kind: 'reboot', source, macro: '@reboot' }
    const expansion = MACROS[macro]
    if (expansion === undefined) {
      fail('macro', null, first.start, `Unknown macro ${first.text}. Known: ${[...Object.keys(MACROS), '@reboot'].join(', ')}.`)
    }
    return build(source, macro, tokenize(expansion), true)
  }

  if (tokens.length > 5) {
    const sixth = tokens[5] as Token
    const seventh = tokens[6]
    const quartzYear = tokens.length === 7 && seventh !== undefined && /^[\d*,/-]+$/.test(seventh.text)
    // A pasted crontab line (`0 5 * * * backup.sh`) has a valid 5-field
    // schedule followed by something that is not a field. Saying so beats
    // reading the command as a day of week and complaining about that.
    if (!quartzYear && succeeds(() => build(source, null, tokens.slice(0, 5), false))) {
      const sixthIsField = succeeds(() => parseField(SPECS.dayOfWeek, sixth.text, sixth.start))
      if (!sixthIsField) {
        fail('field-count', null, sixth.start, 'This looks like a crontab line with a command after the schedule. Paste only the schedule fields.')
      }
    }
    if (quartzYear) {
      fail('quartz', null, (seventh as Token).start, "Quartz syntax isn't standard cron: a seventh (year) field is Quartz-only.")
    }
  }
  if (tokens.length !== 5 && tokens.length !== 6) {
    const at = tokens.length > 6 ? (tokens[6] as Token).start : input.length
    fail(
      'field-count',
      null,
      at,
      `Expected 5 fields (minute hour day-of-month month day-of-week), or 6 with seconds first; got ${tokens.length}.`,
    )
  }
  return build(source, null, tokens, false)
}

function succeeds(run: () => unknown): boolean {
  try {
    run()
    return true
  } catch (e) {
    if (e instanceof Fail) return false
    throw e
  }
}
