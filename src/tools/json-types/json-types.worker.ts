import { expose } from 'comlink'
import { jsonTypes, type JsonTypesOptions, type JsonTypesResult } from '@fadeltd/devtools-core/json-types'

/**
 * Off the main thread because the input is unbounded: a 20 MB payload is a
 * lossless parse and a full walk, and typing in the input must stay responsive.
 */
const api = {
  run(text: string, options: JsonTypesOptions): JsonTypesResult {
    return jsonTypes(text, options)
  },
}

export type JsonTypesApi = typeof api

expose(api)
