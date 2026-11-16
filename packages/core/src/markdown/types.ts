/**
 * The document tree. Plain data: it survives `structuredClone`, so a worker
 * can post it, and it carries nothing of the parser that produced it.
 *
 * Every string in it is plain text, already decoded. Nothing is HTML, so a
 * renderer must escape (or hand it to something that does, like React).
 */

export type MdAlign = 'left' | 'center' | 'right' | null

export type MdInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'del'; children: MdInline[] }
  | { type: 'code'; value: string }
  /** `href` has passed `safeHref`: a link that failed it is not a link node. */
  | { type: 'link'; href: string; title: string | null; children: MdInline[] }
  /** `src` has passed `safeImageSrc`. */
  | { type: 'image'; src: string; alt: string; title: string | null }
  | { type: 'br' }

export interface MdListItem {
  task: boolean
  /** Meaningful only when `task` is true. */
  checked: boolean
  children: MdBlock[]
}

export type MdBlock =
  | { type: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { type: 'paragraph'; children: MdInline[] }
  /** Inline content with no paragraph around it: the body of a tight list item. */
  | { type: 'plain'; children: MdInline[] }
  | { type: 'blockquote'; children: MdBlock[] }
  | { type: 'list'; ordered: boolean; start: number; items: MdListItem[] }
  | { type: 'code'; lang: string; value: string }
  /** `header` is empty for a table with no header row (CSV with the header off). */
  | { type: 'table'; align: MdAlign[]; header: MdInline[][]; rows: MdInline[][][] }
  | { type: 'hr' }

export interface MdDoc {
  blocks: MdBlock[]
}
