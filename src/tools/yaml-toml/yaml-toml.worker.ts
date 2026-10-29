import { expose } from 'comlink'
import {
  convert,
  type ConvertResult,
  type Format,
  type Indent,
  type SourceFormat,
} from '@fadeltd/devtools-core/yaml-toml'

export interface YamlTomlRunInput {
  text: string
  from: SourceFormat
  to: Format
  indent: Indent
  document: 'all' | number
}

/**
 * Off the main thread for two reasons. A multi-MB YAML or TOML paste takes
 * long enough to parse and re-serialise that it would land on every
 * keystroke; and keeping `yaml`, `smol-toml` and `jsonc-parser` in here keeps
 * them out of the route chunk, so the page paints before they have loaded.
 */
const api = {
  run(input: YamlTomlRunInput): ConvertResult {
    return convert(input.text, input.from, input.to, {
      indent: input.indent,
      document: input.document,
      tabWidth: 2,
    })
  },
}

export type YamlTomlApi = typeof api

expose(api)
