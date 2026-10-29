import { cryptoRandomSource, unbiasedBelow, type RandomSource } from '../random/random.ts'

export type LoremUnit = 'words' | 'sentences' | 'paragraphs'
export type LoremFormat = 'text' | 'html' | 'markdown'

export interface LoremOptions {
  count: number
  unit: LoremUnit
  format: LoremFormat
  /** Open with the classic "Lorem ipsum dolor sit amet, consectetur adipiscing elit." */
  startWithLorem: boolean
}

/**
 * The output lands in a textarea, and one more order of magnitude would make
 * typing in the count field lag. 1,000 paragraphs is ~60k words already, far
 * past any layout test; the other two caps are set to roughly match it.
 */
export const LOREM_LIMITS: Readonly<Record<LoremUnit, number>> = {
  words: 50_000,
  sentences: 5_000,
  paragraphs: 1_000,
}

/**
 * The words of the classic passage first, then the rest of the vocabulary the
 * common generators draw from. All lowercase ASCII, so no format needs to
 * escape anything.
 */
export const LOREM_WORDS: readonly string[] = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et ' +
  'dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea ' +
  'commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur ' +
  'excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum ' +
  'a ac accumsan aenean aliquam ante arcu at auctor augue bibendum blandit condimentum congue convallis cras ' +
  'cursus dapibus diam dictum dignissim donec egestas eget eleifend elementum erat eros etiam euismod ' +
  'facilisis fames faucibus felis fermentum feugiat finibus fringilla fusce gravida hendrerit iaculis ' +
  'imperdiet integer interdum justo lacinia lacus laoreet lectus leo libero ligula lobortis luctus maecenas ' +
  'massa mattis mauris metus mi molestie morbi nam nec neque nibh nisl nunc odio orci ornare pellentesque ' +
  'pharetra phasellus placerat porta porttitor posuere praesent pretium proin pulvinar purus quam quisque ' +
  'rhoncus risus rutrum sagittis sapien scelerisque semper senectus sodales sollicitudin suscipit ' +
  'suspendisse tellus tempus tincidunt tortor tristique turpis ultrices ultricies urna varius vehicula vel ' +
  'vestibulum vitae vivamus viverra volutpat vulputate'
).split(' ')

const CLASSIC = { words: LOREM_WORDS.slice(0, 8), comma: 4 }

interface Sentence {
  words: string[]
  /** Index of the word followed by a comma, or -1. */
  comma: number
  /** Index of a word Markdown emphasises, or -1; `strong` picks ** over *. */
  emphasis: number
  strong: boolean
}

export interface LoremResult {
  output: string
  /** The count actually generated, after clamping. */
  count: number
  /** True when the requested count was over the unit's limit. */
  capped: boolean
  words: number
  sentences: number
  paragraphs: number
}

/** A whole number from 0 to the unit's limit; anything unparseable is 0. */
export function clampLoremCount(count: number, unit: LoremUnit): { count: number; capped: boolean } {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  const limit = LOREM_LIMITS[unit]
  return n > limit ? { count: limit, capped: true } : { count: n, capped: false }
}

/**
 * Takes a RandomSource so a seed (`mulberry32`) gives the same text every time,
 * which is what the tests rely on. Every random choice is drawn the same way
 * whatever the format, so one seed gives the same words in text, HTML and
 * Markdown.
 */
export function generateLorem(opts: LoremOptions, next: RandomSource = cryptoRandomSource()): LoremResult {
  const { count, capped } = clampLoremCount(opts.count, opts.unit)
  let previous = ''
  const word = (): string => {
    let w = LOREM_WORDS[unbiasedBelow(next, LOREM_WORDS.length)]!
    // One redraw: "et et" reads as a bug, not as filler.
    if (w === previous) w = LOREM_WORDS[unbiasedBelow(next, LOREM_WORDS.length)]!
    previous = w
    return w
  }
  const sentence = (): Sentence => {
    const length = 4 + unbiasedBelow(next, 11)
    const words = Array.from({ length }, word)
    const comma = length >= 8 && unbiasedBelow(next, 2) === 0 ? 2 + unbiasedBelow(next, length - 4) : -1
    const style = unbiasedBelow(next, 8)
    const emphasis = style < 2 ? 1 + unbiasedBelow(next, length - 1) : -1
    return { words, comma, emphasis, strong: style === 1 }
  }

  let first = opts.startWithLorem
  const firstSentence = (): Sentence => {
    if (!first) return sentence()
    first = false
    previous = CLASSIC.words.at(-1)!
    return { words: [...CLASSIC.words], comma: CLASSIC.comma, emphasis: -1, strong: false }
  }

  const paragraphs: Sentence[][] = []
  if (count > 0) {
    if (opts.unit === 'paragraphs') {
      for (let p = 0; p < count; p++) {
        const n = 3 + unbiasedBelow(next, 5)
        paragraphs.push(Array.from({ length: n }, firstSentence))
      }
    } else if (opts.unit === 'sentences') {
      paragraphs.push(Array.from({ length: count }, firstSentence))
    } else {
      // Whole sentences until the last, which is cut to land on the exact
      // count; a comma that would end up last is dropped with it.
      const para: Sentence[] = []
      let remaining = count
      while (remaining > 0) {
        const s = firstSentence()
        if (s.words.length > remaining) {
          s.words.length = remaining
          if (s.comma >= remaining - 1) s.comma = -1
          if (s.emphasis >= remaining) s.emphasis = -1
        }
        remaining -= s.words.length
        para.push(s)
      }
      paragraphs.push(para)
    }
  }

  let words = 0
  let sentences = 0
  for (const p of paragraphs) {
    sentences += p.length
    for (const s of p) words += s.words.length
  }

  return {
    output: render(paragraphs, opts.format),
    count,
    capped,
    words,
    sentences,
    paragraphs: paragraphs.length,
  }
}

function render(paragraphs: Sentence[][], format: LoremFormat): string {
  const text = paragraphs.map((p) => p.map((s) => renderSentence(s, format === 'markdown')).join(' '))
  return format === 'html' ? text.map((p) => `<p>${p}</p>`).join('\n') : text.join('\n\n')
}

function renderSentence(s: Sentence, markdown: boolean): string {
  let out = ''
  for (let i = 0; i < s.words.length; i++) {
    let w = s.words[i]!
    if (i === 0) w = w[0]!.toUpperCase() + w.slice(1)
    // Markdown gets the odd *italic* or **bold** word, so a renderer has
    // something to render; it stays inside the word, so counts don't change.
    if (markdown && i === s.emphasis) w = s.strong ? `**${w}**` : `*${w}*`
    if (i > 0) out += ' '
    out += w
    if (i === s.comma) out += ','
  }
  return `${out}.`
}
