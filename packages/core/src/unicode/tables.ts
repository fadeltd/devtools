export const UNICODE_FLAGS = [
  'invisible',
  'bidi',
  'control',
  'space',
  'variation',
  'tag',
  'private-use',
  'lone-surrogate',
  'replacement',
] as const

export type UnicodeFlag = (typeof UNICODE_FLAGS)[number]

/** One bit per flag, in UNICODE_FLAGS order, so a row's flags fit in a Uint16Array slot. */
export const FLAG_BIT: Readonly<Record<UnicodeFlag, number>> = Object.fromEntries(
  UNICODE_FLAGS.map((flag, i) => [flag, 1 << i]),
) as Record<UnicodeFlag, number>

const INVISIBLE = FLAG_BIT.invisible
const BIDI = FLAG_BIT.bidi
const CONTROL = FLAG_BIT.control
const SPACE = FLAG_BIT.space
const VARIATION = FLAG_BIT.variation
const TAG = FLAG_BIT.tag
const PRIVATE_USE = FLAG_BIT['private-use']
const LONE_SURROGATE = FLAG_BIT['lone-surrogate']
const REPLACEMENT = FLAG_BIT.replacement

export function flagsOf(mask: number): UnicodeFlag[] {
  const out: UnicodeFlag[] = []
  if (mask === 0) return out
  for (const flag of UNICODE_FLAGS) if ((mask & FLAG_BIT[flag]) !== 0) out.push(flag)
  return out
}

/**
 * Flags a code point carries on its own. Context -- a ZWJ inside an emoji
 * sequence, tags inside a subdivision flag -- is applied by the indexer, which
 * can see the neighbours.
 *
 * Surrogates only reach here unpaired: the indexer combines valid pairs first.
 */
export function baseMask(cp: number): number {
  if (cp < 0x20) return cp === 0x09 || cp === 0x0a || cp === 0x0d ? 0 : CONTROL
  if (cp < 0x7f) return 0
  if (cp <= 0x9f) return CONTROL
  if (cp < 0x2000) {
    switch (cp) {
      case 0x00a0:
      case 0x1680:
        return SPACE
      case 0x00ad:
      case 0x034f:
      case 0x115f:
      case 0x1160:
      case 0x180e:
        return INVISIBLE
      case 0x061c:
        return BIDI
      default:
        return 0
    }
  }
  if (cp <= 0x206f) {
    if (cp <= 0x200a) return SPACE
    if (cp <= 0x200d) return INVISIBLE
    if (cp <= 0x200f) return BIDI
    if (cp === 0x2028 || cp === 0x2029) return CONTROL
    if (cp >= 0x202a && cp <= 0x202e) return BIDI
    if (cp === 0x202f || cp === 0x205f) return SPACE
    if (cp >= 0x2060 && cp <= 0x2064) return INVISIBLE
    if (cp >= 0x2066 && cp <= 0x2069) return BIDI
    return 0
  }
  if (cp === 0x3000) return SPACE
  if (cp === 0x3164) return INVISIBLE
  if (cp >= 0xd800 && cp <= 0xdfff) return LONE_SURROGATE
  if (cp >= 0xe000 && cp <= 0xf8ff) return PRIVATE_USE
  if (cp >= 0xfe00 && cp <= 0xfe0f) return VARIATION
  if (cp === 0xfeff || cp === 0xffa0) return INVISIBLE
  if (cp === 0xfffd) return REPLACEMENT
  if (cp >= 0xe0000 && cp <= 0xe007f) return TAG
  if (cp >= 0xe0100 && cp <= 0xe01ef) return VARIATION
  if (cp >= 0xf0000 && cp <= 0xffffd) return PRIVATE_USE
  if (cp >= 0x100000 && cp <= 0x10fffd) return PRIVATE_USE
  return 0
}

/**
 * Names for the characters this tool flags, and the few unflagged ones whose
 * job is invisible (a ZWJ inside an emoji). Not a name database: everything
 * else shows no name, which keeps UnicodeData out of the bundle.
 */
const NAMES = new Map<number, string>([
  [0x007f, 'DELETE'],
  [0x0085, 'NEXT LINE (NEL)'],
  [0x00a0, 'NO-BREAK SPACE'],
  [0x00ad, 'SOFT HYPHEN'],
  [0x034f, 'COMBINING GRAPHEME JOINER'],
  [0x061c, 'ARABIC LETTER MARK'],
  [0x115f, 'HANGUL CHOSEONG FILLER'],
  [0x1160, 'HANGUL JUNGSEONG FILLER'],
  [0x1680, 'OGHAM SPACE MARK'],
  [0x180e, 'MONGOLIAN VOWEL SEPARATOR'],
  [0x2000, 'EN QUAD'],
  [0x2001, 'EM QUAD'],
  [0x2002, 'EN SPACE'],
  [0x2003, 'EM SPACE'],
  [0x2004, 'THREE-PER-EM SPACE'],
  [0x2005, 'FOUR-PER-EM SPACE'],
  [0x2006, 'SIX-PER-EM SPACE'],
  [0x2007, 'FIGURE SPACE'],
  [0x2008, 'PUNCTUATION SPACE'],
  [0x2009, 'THIN SPACE'],
  [0x200a, 'HAIR SPACE'],
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  [0x2028, 'LINE SEPARATOR'],
  [0x2029, 'PARAGRAPH SEPARATOR'],
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x202f, 'NARROW NO-BREAK SPACE'],
  [0x205f, 'MEDIUM MATHEMATICAL SPACE'],
  [0x2060, 'WORD JOINER'],
  [0x2061, 'FUNCTION APPLICATION'],
  [0x2062, 'INVISIBLE TIMES'],
  [0x2063, 'INVISIBLE SEPARATOR'],
  [0x2064, 'INVISIBLE PLUS'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
  [0x3000, 'IDEOGRAPHIC SPACE'],
  [0x3164, 'HANGUL FILLER'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE (BOM)'],
  [0xffa0, 'HALFWIDTH HANGUL FILLER'],
  [0xfffd, 'REPLACEMENT CHARACTER'],
  [0xe0001, 'LANGUAGE TAG'],
  [0xe0020, 'TAG SPACE'],
  [0xe007f, 'CANCEL TAG'],
])

const C0_NAMES = [
  'NULL', 'START OF HEADING', 'START OF TEXT', 'END OF TEXT', 'END OF TRANSMISSION', 'ENQUIRY',
  'ACKNOWLEDGE', 'BELL', 'BACKSPACE', 'CHARACTER TABULATION', 'LINE FEED', 'LINE TABULATION',
  'FORM FEED', 'CARRIAGE RETURN', 'SHIFT OUT', 'SHIFT IN', 'DATA LINK ESCAPE', 'DEVICE CONTROL ONE',
  'DEVICE CONTROL TWO', 'DEVICE CONTROL THREE', 'DEVICE CONTROL FOUR', 'NEGATIVE ACKNOWLEDGE',
  'SYNCHRONOUS IDLE', 'END OF TRANSMISSION BLOCK', 'CANCEL', 'END OF MEDIUM', 'SUBSTITUTE', 'ESCAPE',
  'INFORMATION SEPARATOR FOUR', 'INFORMATION SEPARATOR THREE', 'INFORMATION SEPARATOR TWO',
  'INFORMATION SEPARATOR ONE',
] as const

function tagName(cp: number): string {
  const ascii = cp - 0xe0000
  if (ascii >= 0x61 && ascii <= 0x7a) return `TAG LATIN SMALL LETTER ${String.fromCharCode(ascii - 0x20)}`
  if (ascii >= 0x41 && ascii <= 0x5a) return `TAG LATIN CAPITAL LETTER ${String.fromCharCode(ascii)}`
  if (ascii >= 0x30 && ascii <= 0x39) return `TAG DIGIT ${String.fromCharCode(ascii)}`
  if (ascii > 0x20 && ascii < 0x7f) return `TAG ${String.fromCharCode(ascii)}`
  return 'TAG'
}

export function nameOf(cp: number): string | null {
  const named = NAMES.get(cp)
  if (named !== undefined) return named
  if (cp < 0x20) return C0_NAMES[cp] ?? null
  if (cp >= 0x80 && cp <= 0x9f) return 'C1 CONTROL'
  if (cp >= 0xd800 && cp <= 0xdbff) return 'LONE HIGH SURROGATE'
  if (cp >= 0xdc00 && cp <= 0xdfff) return 'LONE LOW SURROGATE'
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `VARIATION SELECTOR-${cp - 0xfe00 + 1}`
  if (cp >= 0xe0100 && cp <= 0xe01ef) return `VARIATION SELECTOR-${cp - 0xe0100 + 17}`
  if (cp >= 0xe0000 && cp <= 0xe007f) return tagName(cp)
  if ((baseMask(cp) & PRIVATE_USE) !== 0) return 'PRIVATE USE'
  return null
}

/**
 * Short labels for the placeholder box. A name like "RIGHT-TO-LEFT OVERRIDE"
 * does not fit a 4-character cell, and the U+ code is already its own column.
 */
const ABBREVIATIONS = new Map<number, string>([
  [0x0000, 'NUL'],
  [0x0009, 'TAB'],
  [0x000a, 'LF'],
  [0x000b, 'VT'],
  [0x000c, 'FF'],
  [0x000d, 'CR'],
  [0x001b, 'ESC'],
  [0x0020, 'SP'],
  [0x007f, 'DEL'],
  [0x0085, 'NEL'],
  [0x00a0, 'NBSP'],
  [0x00ad, 'SHY'],
  [0x034f, 'CGJ'],
  [0x061c, 'ALM'],
  [0x200b, 'ZWSP'],
  [0x200c, 'ZWNJ'],
  [0x200d, 'ZWJ'],
  [0x200e, 'LRM'],
  [0x200f, 'RLM'],
  [0x2028, 'LSEP'],
  [0x2029, 'PSEP'],
  [0x202a, 'LRE'],
  [0x202b, 'RLE'],
  [0x202c, 'PDF'],
  [0x202d, 'LRO'],
  [0x202e, 'RLO'],
  [0x202f, 'NNBSP'],
  [0x2060, 'WJ'],
  [0x2066, 'LRI'],
  [0x2067, 'RLI'],
  [0x2068, 'FSI'],
  [0x2069, 'PDI'],
  [0xfeff, 'BOM'],
])

export function abbreviationOf(cp: number): string | null {
  const short = ABBREVIATIONS.get(cp)
  if (short !== undefined) return short
  if (cp >= 0xfe00 && cp <= 0xfe0f) return `VS${cp - 0xfe00 + 1}`
  if (cp >= 0xe0100 && cp <= 0xe01ef) return `VS${cp - 0xe0100 + 17}`
  return null
}

export const GENERAL_CATEGORIES = {
  Lu: 'Uppercase letter',
  Ll: 'Lowercase letter',
  Lt: 'Titlecase letter',
  Lm: 'Modifier letter',
  Lo: 'Other letter',
  Mn: 'Nonspacing mark',
  Mc: 'Spacing mark',
  Me: 'Enclosing mark',
  Nd: 'Decimal number',
  Nl: 'Letter number',
  No: 'Other number',
  Pc: 'Connector punctuation',
  Pd: 'Dash punctuation',
  Ps: 'Open punctuation',
  Pe: 'Close punctuation',
  Pi: 'Initial punctuation',
  Pf: 'Final punctuation',
  Po: 'Other punctuation',
  Sm: 'Math symbol',
  Sc: 'Currency symbol',
  Sk: 'Modifier symbol',
  So: 'Other symbol',
  Zs: 'Space separator',
  Zl: 'Line separator',
  Zp: 'Paragraph separator',
  Cc: 'Control',
  Cf: 'Format',
  Cs: 'Surrogate',
  Co: 'Private use',
  Cn: 'Unassigned',
} as const

export type GeneralCategory = keyof typeof GENERAL_CATEGORIES

/**
 * Tested most-common-first, so ordinary text resolves in a regex or two. Cn is
 * the fallthrough: the engine's own Unicode tables decide what is assigned, so
 * a character newer than the browser reads as Unassigned -- which is true for
 * that browser.
 */
const CATEGORY_TESTS: readonly (readonly [GeneralCategory, RegExp])[] = (
  [
    'Ll', 'Lu', 'Zs', 'Po', 'Nd', 'Cc', 'Lo', 'So', 'Mn', 'Sm', 'Ps', 'Pe', 'Pd', 'Cf', 'Sk', 'Sc',
    'Pc', 'Lm', 'Mc', 'Pi', 'Pf', 'No', 'Lt', 'Me', 'Nl', 'Zl', 'Zp', 'Cs', 'Co',
  ] as const
).map((gc) => [gc, new RegExp(`^\\p{gc=${gc}}$`, 'u')] as const)

export function generalCategory(char: string): GeneralCategory {
  for (const [gc, re] of CATEGORY_TESTS) if (re.test(char)) return gc
  return 'Cn'
}
