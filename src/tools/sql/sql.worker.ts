import { expose } from 'comlink'
import {
  formatSql,
  minifySql,
  type SqlDialect,
  type SqlIndent,
  type SqlKeywordCase,
  type SqlResult,
} from '@fadeltd/devtools-core/sql'

export interface SqlJob {
  text: string
  mode: 'format' | 'minify'
  dialect: SqlDialect
  keywordCase: SqlKeywordCase
  indent: SqlIndent
  linesBetweenQueries: number
  stripComments: boolean
}

/**
 * Off the main thread because sql-formatter's nearley parser is slow on a big
 * dump -- seconds, on some inputs -- and a frozen tab cannot even offer Cancel.
 * Only the result string crosses back.
 */
const api = {
  async run(job: SqlJob): Promise<SqlResult> {
    if (job.mode === 'minify') {
      return {
        ok: true,
        output: minifySql(job.text, { dialect: job.dialect, stripComments: job.stripComments }),
      }
    }
    return formatSql(job.text, {
      dialect: job.dialect,
      keywordCase: job.keywordCase,
      indent: job.indent,
      linesBetweenQueries: job.linesBetweenQueries,
    })
  },
}

export type SqlApi = typeof api

expose(api)
