import { expose } from 'comlink'
import { limitDoc, parseMarkdown, toHtml, type MdDoc } from '@fadeltd/devtools-core/markdown'

/**
 * How much of a document the preview draws. It is real DOM, not virtualised,
 * so a 100,000-item list has to stop somewhere; the copy does not.
 */
const PREVIEW_BUDGET = 12_000

export interface MarkdownRender {
  /** What the preview draws: the whole document, or its start. */
  doc: MdDoc
  truncated: boolean
  /** The whole document, ready for the clipboard before the click arrives. */
  html: string
}

/**
 * Off the main thread because the tokenizer is quadratic on some input: fifty
 * thousand `*` in a row take it fifteen seconds, and it never yields, so only
 * terminate() can stop it.
 */
const api = {
  render(text: string): MarkdownRender {
    const doc = parseMarkdown(text)
    const limited = limitDoc(doc, PREVIEW_BUDGET)
    return { doc: limited.doc, truncated: limited.truncated, html: toHtml(doc) }
  },
}

export type MarkdownApi = typeof api

expose(api)
