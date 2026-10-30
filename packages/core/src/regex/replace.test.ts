import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { replacementIssues, replaceWith } from './replace.ts'

describe('replaceWith', () => {
  it('replaces and counts', () => {
    expect(replaceWith('a-b-c', /-/g, '+')).toEqual({ output: 'a+b+c', count: 2 })
    expect(replaceWith('a-b-c', /-/, '+')).toEqual({ output: 'a+b-c', count: 1 })
    expect(replaceWith('abc', /x/g, '+')).toEqual({ output: 'abc', count: 0 })
  })

  it('expands every reference form', () => {
    expect(replaceWith('2024-10', /(?<y>\d+)-(\d+)/, '$2/$<y> [$&] $$')).toEqual({ output: '10/2024 [2024-10] $', count: 1 })
    expect(replaceWith('xay', /a/, "[$`|$']")).toEqual({ output: 'x[x|y]y', count: 1 })
  })

  it('matches String.prototype.replace for any template', () => {
    const regexes = [/(a)(b)?/g, /(?<n>a)|(?<m>b)/g, /a/g, /(a)/, /x/g, /(?:)/g, /(a)(a)(a)(a)(a)(a)(a)(a)(a)(a)(a)/g]
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom('a', 'b', 'c') }),
        fc.string({ unit: fc.constantFrom('$', '&', '`', "'", '<', '>', 'n', 'm', 'q', '0', '1', '2', '9', 'x') }),
        fc.constantFrom(...regexes),
        (text, template, regex) => {
          expect(replaceWith(text, regex, template).output).toBe(text.replace(new RegExp(regex), template))
        },
      ),
    )
  })
})

const issues = (template: string, names: Array<string | null>) =>
  replacementIssues(template, names).map((i) => i.message)

describe('replacementIssues', () => {
  it('says nothing about valid references', () => {
    expect(issues('$1 $<y> $& $$1 $` $\'', [null, 'y'])).toEqual([])
  })

  it('flags references that are inserted as written or as nothing', () => {
    expect(issues('$3', [null])).toEqual(['$3 is inserted as written: the pattern has 1 capture group.'])
    expect(issues('$1', [])).toEqual(['$1 is inserted as written: the pattern has no capture groups.'])
    expect(issues('$0', [null])).toEqual(['$0 is inserted as written: there is no group 0. Use $& for the whole match.'])
    expect(issues('$<y>', [null])).toEqual(['$<y> is inserted as written: the pattern has no named groups.'])
    expect(issues('$<z>', ['y'])).toEqual(['$<z> inserts nothing: no group is named "z".'])
    expect(issues('$<y', ['y'])).toEqual(['$< has no closing >, so it is inserted as written.'])
    expect(issues('\\1', [null])).toEqual(['\\1 is inserted as written: JavaScript replacements use $1.'])
  })

  it('reads $10 the way the engine does', () => {
    // One group: $10 is $1 followed by "0", so it is fine.
    expect(issues('$10', [null])).toEqual([])
  })

  it('reports each reference once', () => {
    expect(issues('$5 $5', [])).toHaveLength(1)
  })
})
