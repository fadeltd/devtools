import { fail, quoteChar, trimBounds, type Parsed } from '../number/error.ts'
import { hslToRgb, normalizeHue, type Color } from './convert.ts'
import { NAMED_COLORS } from './named.ts'

export type Notation = 'hex' | 'rgb' | 'hsl' | 'oklch' | 'named'

export type ColorParse = Parsed<{
  color: Color
  notation: Notation
  /**
   * Things the browser would also do silently, said out loud: a value clamped
   * into range, or a hex read without its `#`.
   */
  notes: string[]
}>

type Unit = '' | '%' | 'deg' | 'rad' | 'grad' | 'turn'

type Token =
  | { kind: 'num'; value: number; unit: Unit; index: number; text: string }
  | { kind: 'none'; index: number; text: string }
  | { kind: 'comma'; index: number; text: string }
  | { kind: 'slash'; index: number; text: string }

type Value = Extract<Token, { kind: 'num' | 'none' }>

const SUPPORTED = ['rgb', 'rgba', 'hsl', 'hsla', 'oklch'] as const
type Fn = (typeof SUPPORTED)[number]

/** Functions people will paste that are valid CSS but out of scope here. */
const KNOWN_UNSUPPORTED = new Set(['hwb', 'lab', 'lch', 'oklab', 'color', 'color-mix', 'light-dark', 'var', 'device-cmyk'])

const HEX = /^[0-9a-f]$/i
const WORD = /[A-Za-z0-9_-]/
// CSS <number>: an optional sign, digits with an optional fraction (or a bare
// fraction), and an optional exponent. Sticky, so it matches only at lastIndex.
const NUMBER = /[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y
const UNIT = /[A-Za-z%]+/y
const ANGLE_TO_DEG: Record<string, number> = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 }

/**
 * Read one CSS color: hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()` /
 * `rgba()`, `hsl()` / `hsla()`, `oklch()`, a named color or `transparent`.
 *
 * Follows CSS Color 4: both the comma (legacy) and space (modern) syntaxes,
 * `/ alpha`, percentages, `none`, and angle units. Like a browser, values out
 * of range are clamped rather than rejected, but each clamp is noted. What a
 * browser would reject is rejected here too, with the position of the culprit.
 */
export function parseColor(input: string): ColorParse {
  const [start, end] = trimBounds(input)
  if (start === end) return fail('empty', 'Enter a color.')

  if (input[start] === '#') return parseHex(input, start + 1, end, false)

  let i = start
  while (i < end && WORD.test(input[i] ?? '')) i++
  if (i === start) {
    return fail(
      'unexpected',
      `${quoteChar(input[start] ?? '')} can't start a color. Use #hex, rgb(…), hsl(…), oklch(…) or a color name.`,
      start,
      input[start],
    )
  }
  const word = input.slice(start, i)
  const lower = word.toLowerCase()

  if (input[i] === '(') {
    if ((SUPPORTED as readonly string[]).includes(lower)) return parseFunction(input, lower as Fn, i + 1, end)
    if (KNOWN_UNSUPPORTED.has(lower)) {
      return fail(
        'unsupported',
        `${lower}() is valid CSS but isn't supported here. Use hex, rgb(), hsl(), oklch() or a color name.`,
        start,
      )
    }
    return fail('unknown-function', `${word}() isn't a CSS color function.`, start)
  }

  if (i < end) {
    const ch = input[i] ?? ''
    if (/\s/.test(ch)) {
      return fail('trailing', `Unexpected text after “${word}”. Enter one color at a time.`, i)
    }
    return fail('unexpected', `Unexpected ${quoteChar(ch)}.`, i, ch)
  }

  if (lower === 'transparent') {
    return { ok: true, color: { space: 'srgb', r: 0, g: 0, b: 0, alpha: 0 }, notation: 'named', notes: [] }
  }
  const named = NAMED_COLORS[lower]
  if (named !== undefined) {
    const hex = parseHex(named, 0, named.length, false)
    return hex.ok ? { ...hex, notation: 'named' } : hex
  }
  // A hex code pasted from a design tool often arrives without its `#`. Only
  // 6 and 8 digits are taken this way: a 3-letter word like "bad" or "add" is
  // far more likely a typo than a color.
  if ((word.length === 6 || word.length === 8) && [...word].every((c) => HEX.test(c))) {
    return parseHex(input, start, end, true)
  }
  if (lower === 'currentcolor') {
    return fail('context', 'currentColor depends on where it is used, so it has no value on its own.', start)
  }
  return fail('unknown-name', `“${word}” isn't a CSS color name.`, start)
}

function parseHex(input: string, from: number, end: number, assumedHash: boolean): ColorParse {
  for (let i = from; i < end; i++) {
    const ch = input[i] ?? ''
    if (!HEX.test(ch)) return fail('hex-digit', `${quoteChar(ch)} isn't a hex digit (0–9, a–f).`, i, ch)
  }
  const digits = input.slice(from, end)
  const n = digits.length
  if (n !== 3 && n !== 4 && n !== 6 && n !== 8) {
    return fail('hex-length', `A hex color has 3, 4, 6 or 8 digits, not ${n}.`, n === 0 ? from - 1 : from)
  }
  const short = n <= 4
  const at = (k: number) => {
    const pair = short ? (digits[k] ?? '0').repeat(2) : digits.slice(k * 2, k * 2 + 2)
    return parseInt(pair, 16) / 255
  }
  const alpha = n === 4 || n === 8 ? at(3) : 1
  return {
    ok: true,
    color: { space: 'srgb', r: at(0), g: at(1), b: at(2), alpha },
    notation: 'hex',
    notes: assumedHash ? [`Read as #${digits}.`] : [],
  }
}

function tokenize(input: string, from: number, end: number): Parsed<{ tokens: Token[]; close: number }> {
  const tokens: Token[] = []
  let i = from
  while (i < end) {
    const ch = input[i] ?? ''
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === ')') {
      for (let j = i + 1; j < end; j++) {
        if (!/\s/.test(input[j] ?? '')) {
          return fail('trailing', 'Unexpected text after “)”. Enter one color at a time.', j)
        }
      }
      return { ok: true, tokens, close: i }
    }
    if (ch === ',' || ch === '/') {
      tokens.push({ kind: ch === ',' ? 'comma' : 'slash', index: i, text: ch })
      i++
      continue
    }
    NUMBER.lastIndex = i
    const num = NUMBER.exec(input)
    if (num !== null && num.index === i) {
      let j = i + num[0].length
      UNIT.lastIndex = j
      const unitMatch = UNIT.exec(input)
      let unit: Unit = ''
      if (unitMatch !== null && unitMatch.index === j) {
        const u = unitMatch[0].toLowerCase()
        if (u !== '%' && !(u in ANGLE_TO_DEG)) {
          return fail('unit', `“${unitMatch[0]}” isn't a unit a color takes. Use %, deg, rad, grad or turn.`, j)
        }
        unit = u as Unit
        j += unitMatch[0].length
      }
      tokens.push({ kind: 'num', value: Number(num[0]), unit, index: i, text: input.slice(i, j) })
      i = j
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i
      while (j < end && /[A-Za-z-]/.test(input[j] ?? '')) j++
      const word = input.slice(i, j)
      if (word.toLowerCase() === 'none') {
        tokens.push({ kind: 'none', index: i, text: word })
        i = j
        continue
      }
      return fail('unexpected', `Unexpected “${word}”. Expected a number, a percentage or none.`, i)
    }
    return fail('unexpected', `Unexpected ${quoteChar(ch)}.`, i, ch)
  }
  return fail('unclosed', 'Missing the closing “)”.', end)
}

interface Args {
  channels: [Value, Value, Value]
  alpha: Value | null
  legacy: boolean
}

/**
 * Split tokens into three channels and an optional alpha, enforcing one
 * syntax or the other: `rgb(1, 2, 3, 0.5)` or `rgb(1 2 3 / 0.5)`, never a mix.
 */
function splitArgs(tokens: Token[], close: number, fn: Fn): Parsed<{ args: Args }> {
  const legacy = tokens.some((t) => t.kind === 'comma')
  const values: Value[] = []
  let alpha: Value | null = null

  if (legacy) {
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k]!
      const wantComma = k % 2 === 1
      if (t.kind === 'slash') {
        return fail('syntax', 'With commas, alpha is the fourth value after a comma, not after “/”.', t.index)
      }
      if (wantComma && t.kind !== 'comma') {
        return fail('syntax', 'Use commas between every value, or spaces between all of them, not a mix.', t.index)
      }
      if (!wantComma) {
        if (t.kind === 'comma') return fail('syntax', 'Expected a value before this comma.', t.index)
        if (t.kind === 'none') {
          return fail('syntax', '“none” only works in the space syntax, without commas.', t.index)
        }
        values.push(t)
      }
    }
    const last = tokens[tokens.length - 1]
    if (last?.kind === 'comma') return fail('syntax', 'Expected a value after this comma.', last.index)
    if (values.length > 4) return fail('count', `${fn}() takes 3 values and an optional alpha.`, values[4]!.index)
    if (values.length === 4) alpha = values.pop()!
  } else {
    const slash = tokens.findIndex((t) => t.kind === 'slash')
    const before = slash < 0 ? tokens : tokens.slice(0, slash)
    for (const t of before) if (t.kind === 'num' || t.kind === 'none') values.push(t)
    if (values.length > 3) {
      return fail('count', `${fn}() takes 3 values, then “/” and alpha.`, values[3]!.index)
    }
    if (slash >= 0) {
      const after = tokens.slice(slash + 1)
      const first = after[0]
      if (first === undefined) return fail('syntax', 'Expected an alpha value after “/”.', close)
      if (first.kind !== 'num' && first.kind !== 'none') {
        return fail('syntax', 'Expected an alpha value after “/”.', first.index)
      }
      if (after.length > 1) return fail('count', 'Only one alpha value goes after “/”.', after[1]!.index)
      alpha = first
    }
  }

  if (values.length < 3) {
    return fail('count', `${fn}() needs 3 values; found ${values.length}.`, close)
  }
  return { ok: true, args: { channels: [values[0]!, values[1]!, values[2]!], legacy, alpha } }
}

/** A hue: a bare number is degrees; `none` is 0. */
function angle(t: Value): Parsed<{ deg: number }> {
  if (t.kind === 'none') return { ok: true, deg: 0 }
  if (t.unit === '%') return fail('unit', 'Hue is an angle or a number of degrees, not a percentage.', t.index)
  return { ok: true, deg: normalizeHue(t.value * (ANGLE_TO_DEG[t.unit] ?? 1)) }
}

function parseFunction(input: string, fn: Fn, from: number, end: number): ColorParse {
  const tok = tokenize(input, from, end)
  if (!tok.ok) return tok
  const split = splitArgs(tok.tokens, tok.close, fn)
  if (!split.ok) return split
  const { channels, alpha: alphaTok, legacy } = split.args
  const notes: string[] = []

  /** Clamp into [lo, hi], noting the clamp against the token as written. */
  const clamp = (v: number, lo: number, hi: number, t: Value, what: string): number => {
    if (v < lo || v > hi) {
      const to = v < lo ? lo : hi
      notes.push(`${what} ${t.text} is out of range; clamped as a browser would.`)
      return to
    }
    return v
  }

  let alpha = 1
  if (alphaTok !== null) {
    if (alphaTok.kind === 'none') alpha = 0
    else if (alphaTok.unit === '%') alpha = clamp(alphaTok.value / 100, 0, 1, alphaTok, 'Alpha')
    else if (alphaTok.unit === '') alpha = clamp(alphaTok.value, 0, 1, alphaTok, 'Alpha')
    else return fail('unit', 'Alpha is a number or a percentage, not an angle.', alphaTok.index)
  }

  if (fn === 'rgb' || fn === 'rgba') {
    // Legacy rgb() must be all numbers or all percentages; browsers reject a mix.
    if (legacy) {
      const pct = channels[0].kind === 'num' && channels[0].unit === '%'
      for (const t of channels) {
        if (t.kind === 'num' && (t.unit === '%') !== pct) {
          return fail(
            'syntax',
            'With commas, rgb() values must be all numbers or all percentages.',
            t.index,
          )
        }
      }
    }
    const rgb: number[] = []
    for (const [k, t] of channels.entries()) {
      const label = ['Red', 'Green', 'Blue'][k]!
      if (t.kind === 'none') rgb.push(0)
      else if (t.unit === '%') rgb.push(clamp(t.value, 0, 100, t, label) / 100)
      else if (t.unit === '') rgb.push(clamp(t.value, 0, 255, t, label) / 255)
      else return fail('unit', `${label} is a number 0–255 or a percentage, not an angle.`, t.index)
    }
    return {
      ok: true,
      color: { space: 'srgb', r: rgb[0]!, g: rgb[1]!, b: rgb[2]!, alpha },
      notation: 'rgb',
      notes,
    }
  }

  if (fn === 'hsl' || fn === 'hsla') {
    const h = angle(channels[0])
    if (!h.ok) return h
    const pct: number[] = []
    for (const [k, t] of [channels[1], channels[2]].entries()) {
      const label = k === 0 ? 'Saturation' : 'Lightness'
      if (t.kind === 'none') {
        pct.push(0)
        continue
      }
      if (t.unit !== '%' && t.unit !== '') {
        return fail('unit', `${label} is a percentage, not an angle.`, t.index)
      }
      // CSS Color 4 lets the space syntax drop the %; the legacy syntax may not.
      if (t.unit === '' && legacy) return fail('unit', `With commas, ${label.toLowerCase()} needs a %.`, t.index)
      pct.push(clamp(t.value, 0, 100, t, label))
    }
    const rgb = hslToRgb({ h: h.deg, s: pct[0]!, l: pct[1]! })
    return { ok: true, color: { space: 'srgb', ...rgb, alpha }, notation: 'hsl', notes }
  }

  // oklch() has no legacy syntax.
  if (legacy) {
    const comma = tok.tokens.find((t) => t.kind === 'comma')!
    return fail('syntax', 'oklch() takes spaces between values, not commas.', comma.index)
  }
  const [lt, ct, ht] = channels
  let l = 0
  if (lt.kind === 'num') {
    if (lt.unit !== '' && lt.unit !== '%') return fail('unit', 'Lightness is a number 0–1 or a percentage.', lt.index)
    l = clamp(lt.unit === '%' ? lt.value / 100 : lt.value, 0, 1, lt, 'Lightness')
  }
  let c = 0
  if (ct.kind === 'num') {
    if (ct.unit !== '' && ct.unit !== '%') return fail('unit', 'Chroma is a number or a percentage.', ct.index)
    // In oklch(), 100% chroma means 0.4 (CSS Color 4 §9.3).
    const raw = ct.unit === '%' ? (ct.value / 100) * 0.4 : ct.value
    // Chroma has no upper bound in CSS; only a negative one is clamped.
    c = clamp(raw, 0, Infinity, ct, 'Chroma')
  }
  const h = angle(ht)
  if (!h.ok) return h
  return { ok: true, color: { space: 'oklch', l, c, h: h.deg, alpha }, notation: 'oklch', notes }
}
