import { expose } from 'comlink'
import { runRegex, type RegexRun, type RegexRunInput } from '@fadeltd/devtools-core/regex'

/**
 * Every use of the user's pattern happens here, compiling included: a pattern
 * like (a+)+$ backtracks without end, never yields, and only terminate() can
 * stop it.
 */
const api = {
  run(input: RegexRunInput): RegexRun {
    return runRegex(input)
  },
}

export type RegexApi = typeof api

expose(api)
