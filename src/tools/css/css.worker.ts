import { expose } from 'comlink'
import {
  formatCss,
  minifyCss,
  type CssParser,
  type CssResult,
} from '@fadeltd/devtools-core/css'

export interface CssJob {
  text: string
  mode: 'format' | 'minify'
  parser: CssParser
  printWidth: number
  indent: 2 | 4 | 'tab'
  singleQuote: boolean
}

/**
 * Off the main thread because Prettier is synchronous under its async API: a
 * framework stylesheet takes long enough to drop frames on every keystroke.
 * Prettier itself is only imported by a format run, never by minify.
 */
const api = {
  async run(job: CssJob): Promise<CssResult> {
    if (job.mode === 'minify') return { ok: true, output: minifyCss(job.text) }
    return formatCss(job.text, {
      parser: job.parser,
      printWidth: job.printWidth,
      tabWidth: job.indent === 'tab' ? 2 : job.indent,
      useTabs: job.indent === 'tab',
      singleQuote: job.singleQuote,
    })
  },
}

export type CssApi = typeof api

expose(api)
