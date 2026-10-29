/**
 * Named character references, deliberately partial. The full HTML5 table is
 * ~2,200 entries (~10 kB gzip) for a tail nobody pastes; an unknown name is
 * left untouched rather than guessed at, so a miss is visible, never corrupt.
 */
const NAMED: Record<string, number> = {
  amp: 0x26,
  lt: 0x3c,
  gt: 0x3e,
  quot: 0x22,
  apos: 0x27,
  OElig: 0x152,
  oelig: 0x153,
  Scaron: 0x160,
  scaron: 0x161,
  Yuml: 0x178,
  fnof: 0x192,
  circ: 0x2c6,
  tilde: 0x2dc,
  Delta: 0x394,
  Pi: 0x3a0,
  Sigma: 0x3a3,
  Omega: 0x3a9,
  alpha: 0x3b1,
  beta: 0x3b2,
  gamma: 0x3b3,
  delta: 0x3b4,
  epsilon: 0x3b5,
  theta: 0x3b8,
  lambda: 0x3bb,
  mu: 0x3bc,
  pi: 0x3c0,
  sigma: 0x3c3,
  tau: 0x3c4,
  phi: 0x3c6,
  omega: 0x3c9,
  ensp: 0x2002,
  emsp: 0x2003,
  thinsp: 0x2009,
  zwnj: 0x200c,
  zwj: 0x200d,
  lrm: 0x200e,
  rlm: 0x200f,
  ndash: 0x2013,
  mdash: 0x2014,
  lsquo: 0x2018,
  rsquo: 0x2019,
  sbquo: 0x201a,
  ldquo: 0x201c,
  rdquo: 0x201d,
  bdquo: 0x201e,
  dagger: 0x2020,
  Dagger: 0x2021,
  bull: 0x2022,
  hellip: 0x2026,
  permil: 0x2030,
  prime: 0x2032,
  Prime: 0x2033,
  lsaquo: 0x2039,
  rsaquo: 0x203a,
  euro: 0x20ac,
  trade: 0x2122,
  larr: 0x2190,
  uarr: 0x2191,
  rarr: 0x2192,
  darr: 0x2193,
  harr: 0x2194,
  crarr: 0x21b5,
  lArr: 0x21d0,
  rArr: 0x21d2,
  hArr: 0x21d4,
  forall: 0x2200,
  part: 0x2202,
  exist: 0x2203,
  empty: 0x2205,
  nabla: 0x2207,
  isin: 0x2208,
  notin: 0x2209,
  prod: 0x220f,
  sum: 0x2211,
  minus: 0x2212,
  radic: 0x221a,
  infin: 0x221e,
  and: 0x2227,
  or: 0x2228,
  cap: 0x2229,
  cup: 0x222a,
  there4: 0x2234,
  asymp: 0x2248,
  ne: 0x2260,
  equiv: 0x2261,
  le: 0x2264,
  ge: 0x2265,
  loz: 0x25ca,
  spades: 0x2660,
  clubs: 0x2663,
  hearts: 0x2665,
  diams: 0x2666,
}

// U+00A0..U+00FF all have names, in code point order.
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr ' +
  'deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml ' +
  'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
LATIN1.split(' ').forEach((name, i) => {
  NAMED[name] = 0xa0 + i
})

/**
 * The HTML spec remaps numeric references in 0x80..0x9F to their windows-1252
 * meaning, because that is what `&#150;` always meant in practice. Without it
 * an en dash decodes to an invisible C1 control.
 */
const CP1252: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x2c6,
  0x89: 0x2030,
  0x8a: 0x160,
  0x8b: 0x2039,
  0x8c: 0x152,
  0x8e: 0x17d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x2dc,
  0x99: 0x2122,
  0x9a: 0x161,
  0x9b: 0x203a,
  0x9c: 0x153,
  0x9e: 0x17e,
  0x9f: 0x178,
}

const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g

function fromCodePoint(cp: number): string {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�'
  return String.fromCodePoint(CP1252[cp] ?? cp)
}

/**
 * Decode character references in a single pass, so `&amp;lt;` becomes `&lt;`
 * and not `<`. Only the terminated form is recognised: `&copy=2` in a pasted
 * URL stays as typed.
 */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(ENTITY, (whole, dec?: string, hex?: string, name?: string) => {
    if (dec !== undefined) return fromCodePoint(Number.parseInt(dec, 10))
    if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16))
    const cp = Object.hasOwn(NAMED, name!) ? NAMED[name!] : undefined
    return cp === undefined ? whole : String.fromCodePoint(cp)
  })
}
