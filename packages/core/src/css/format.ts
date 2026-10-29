export type CssParser = 'css' | 'scss' | 'less'

export interface CssFormatOptions {
  parser: CssParser
  printWidth: number
  tabWidth: number
  useTabs: boolean
  singleQuote: boolean
}

export const DEFAULT_CSS_FORMAT: CssFormatOptions = {
  parser: 'css',
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  singleQuote: false,
}

export interface CssError {
  message: string
  /** 1-based, when the parser reported a position. */
  line: number | null
  /** 1-based, when the parser reported a position. */
  column: number | null
}

export type CssResult = { ok: true; output: string } | { ok: false; error: CssError }

interface PrettierSyntaxError {
  message: string
  loc?: { start?: { line?: number; column?: number } }
}

function isPrettierSyntaxError(e: unknown): e is PrettierSyntaxError {
  return e instanceof Error && 'loc' in e
}

/**
 * Prettier's message is `CssSyntaxError: Unclosed block (3:6)` followed by a
 * code frame. The UI draws its own position line, so keep only the sentence;
 * the position comes from `loc`, which Prettier fills in for parser errors.
 */
export function parseCssError(e: unknown): CssError {
  const raw = e instanceof Error ? e.message : String(e)
  const first = (raw.split('\n')[0] ?? raw).trim()
  const message =
    first
      .replace(/^(?:Css)?SyntaxError:\s*/, '')
      .replace(/\s*\(\d+:\d+\)$/, '')
      .trim() || 'Could not parse this stylesheet'

  const start = isPrettierSyntaxError(e) ? e.loc?.start : undefined
  let line = typeof start?.line === 'number' ? start.line : null
  let column = typeof start?.column === 'number' ? start.column : null
  if (line === null) {
    // Some plugin errors carry the position only in the message.
    const pos = /\((\d+):(\d+)\)$/.exec(first)
    if (pos) {
      line = Number(pos[1])
      column = Number(pos[2])
    }
  }
  return { message, line, column }
}

/**
 * Pretty-print with Prettier. Only the standalone build and the postcss plugin
 * are used: Prettier's Node entry points use `eval`, which the site's CSP
 * forbids. Both are imported here rather than at the top of the module (~70 kB
 * gzip together), so importing this subpath costs nothing until a stylesheet
 * is actually formatted.
 */
export async function formatCss(
  input: string,
  opts: Partial<CssFormatOptions> = {},
): Promise<CssResult> {
  const o = { ...DEFAULT_CSS_FORMAT, ...opts }
  if (input.trim() === '') return { ok: true, output: '' }

  try {
    const [prettier, postcss] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/postcss'),
    ])
    const output = await prettier.format(input, {
      parser: o.parser,
      plugins: [postcss],
      printWidth: o.printWidth,
      tabWidth: o.tabWidth,
      useTabs: o.useTabs,
      singleQuote: o.singleQuote,
    })
    return { ok: true, output }
  } catch (e) {
    return { ok: false, error: parseCssError(e) }
  }
}
