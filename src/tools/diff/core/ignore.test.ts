import { describe, expect, it } from 'vitest'
import { NO_IGNORE, ignoreLabel, keysFor, type IgnoreOptions } from './ignore'

const WS: IgnoreOptions = { ...NO_IGNORE, whitespace: true }
const CASE: IgnoreOptions = { ...NO_IGNORE, case: true }
const TRIM: IgnoreOptions = { ...NO_IGNORE, trim: true }

const sameLine = (o: IgnoreOptions, x: string, y: string) => {
  const k = keysFor(o)!
  return k.line(x) === k.line(y)
}
const sameWord = (o: IgnoreOptions, x: string, y: string) => {
  const k = keysFor(o)!
  return k.word(x) === k.word(y)
}

describe('keysFor', () => {
  it('is undefined when nothing is ignored, so tokens compare exactly', () => {
    expect(keysFor(NO_IGNORE)).toBeUndefined()
  })

  it('whitespace ignores every whitespace difference, like git diff -w', () => {
    expect(sameLine(WS, 'a  b\n', 'a b\n')).toBe(true)
    expect(sameLine(WS, '\ta\r\n', 'a')).toBe(true)
    expect(sameLine(WS, 'ab', 'a b')).toBe(true)
    expect(sameLine(WS, 'a b', 'a c')).toBe(false)
    expect(sameWord(WS, '  ', '\t')).toBe(true)
    expect(sameWord(WS, '\r\n', '\n')).toBe(true)
    // A moved line break is a real change even under -w, or a changed line
    // run would end up with nothing highlighted and no chunk to jump to.
    expect(sameWord(WS, '\n', ' ')).toBe(false)
    expect(sameWord(WS, 'a', 'b')).toBe(false)
  })

  it('case compares case-insensitively and nothing else', () => {
    expect(sameLine(CASE, 'Foo\n', 'fOO\n')).toBe(true)
    expect(sameLine(CASE, 'a b', 'a  b')).toBe(false)
    expect(sameWord(CASE, 'BAR', 'bar')).toBe(true)
  })

  it('trim ignores leading/trailing whitespace, CR and the line break only', () => {
    expect(sameLine(TRIM, '  a\r\n', 'a')).toBe(true)
    expect(sameLine(TRIM, 'a\r\n', 'a\n')).toBe(true)
    expect(sameLine(TRIM, 'a b', 'a  b')).toBe(false)
    expect(sameWord(TRIM, 'A', 'a')).toBe(false)
  })

  it('composes options', () => {
    expect(sameLine({ whitespace: true, case: true, trim: false }, 'A B\n', 'ab')).toBe(true)
    expect(sameLine({ whitespace: false, case: true, trim: true }, '  Foo\r\n', 'foo')).toBe(true)
  })
})

describe('ignoreLabel', () => {
  it('is null when nothing is ignored', () => {
    expect(ignoreLabel(NO_IGNORE)).toBeNull()
  })

  it('names every active option in a fixed order', () => {
    expect(ignoreLabel({ whitespace: true, case: true, trim: true })).toBe(
      'whitespace, case, leading/trailing whitespace',
    )
    expect(ignoreLabel(CASE)).toBe('case')
  })
})
