import { describe, expect, it } from 'vitest'
import { buildModel, identifier, rootIdentifier, singular, wordsOf } from './model.ts'
import { inferShape } from './shape.ts'

function names(value: unknown, casing: 'pascal' | 'go' = 'pascal', root = 'Root') {
  const model = buildModel(inferShape([value]).shape, root, casing)
  return { alias: model.alias?.name ?? null, decls: model.decls.map((d) => d.name) }
}

describe('singular', () => {
  it.each([
    ['users', 'user'],
    ['categories', 'category'],
    ['addresses', 'address'],
    ['boxes', 'box'],
    ['matches', 'match'],
    ['children', 'child'],
    ['people', 'person'],
    ['days', 'day'],
  ])('%s → %s', (plural, one) => {
    expect(singular([plural])).toEqual([one])
  })

  it('appends Item when a word does not singularise', () => {
    expect(singular(['data'])).toEqual(['data', 'item'])
    expect(singular(['status'])).toEqual(['status', 'item'])
    expect(singular(['analysis'])).toEqual(['analysis', 'item'])
    expect(singular(['series'])).toEqual(['series', 'item'])
    expect(singular([])).toEqual(['item'])
  })

  it('changes only the last word, and leaves Item alone', () => {
    expect(singular(['order', 'lines'])).toEqual(['order', 'line'])
    expect(singular(['matrix', 'item'])).toEqual(['matrix', 'item'])
  })
})

describe('identifier', () => {
  it('PascalCases words', () => {
    expect(identifier(wordsOf('user_id'), 'pascal', 'X')).toBe('UserId')
    expect(identifier(wordsOf('foo-bar baz'), 'pascal', 'X')).toBe('FooBarBaz')
  })

  it('upper-cases Go initialisms', () => {
    expect(identifier(wordsOf('user_id'), 'go', 'X')).toBe('UserID')
    expect(identifier(wordsOf('apiKey'), 'go', 'X')).toBe('APIKey')
    expect(identifier(wordsOf('html_url'), 'go', 'X')).toBe('HTMLURL')
  })

  it('prefixes a leading digit, and a non-exported Go name', () => {
    expect(identifier(wordsOf('1st'), 'pascal', 'X')).toBe('The1st')
    expect(identifier(wordsOf('名前'), 'pascal', 'X')).toBe('名前')
    expect(identifier(wordsOf('名前'), 'go', 'X')).toBe('The名前')
  })

  it('falls back when nothing is left', () => {
    expect(identifier(wordsOf(''), 'go', 'Field')).toBe('Field')
    expect(identifier(wordsOf('$$$'), 'pascal', 'Type')).toBe('Type')
  })
})

describe('rootIdentifier', () => {
  it('keeps a valid identifier exactly as typed', () => {
    expect(rootIdentifier('APIResponse', 'pascal')).toBe('APIResponse')
    expect(rootIdentifier('  User ', 'go')).toBe('User')
  })

  it('cases anything else like a key', () => {
    expect(rootIdentifier('user profile', 'pascal')).toBe('UserProfile')
    expect(rootIdentifier('user', 'go')).toBe('User')
    expect(rootIdentifier('', 'pascal')).toBe('Root')
  })
})

describe('buildModel', () => {
  it('names nested objects from their keys, root first', () => {
    expect(names({ user: { address: { city: 'x' } } })).toEqual({
      alias: null,
      decls: ['Root', 'User', 'Address'],
    })
  })

  it('singularises array element types', () => {
    expect(names({ users: [{ id: 1 }], data: [{ id: 'x' }] }).decls).toEqual(['Root', 'User', 'DataItem'])
  })

  it('shares one type between identical structures', () => {
    const shared = { street: 's', city: 'c' }
    expect(names({ billing: shared, shipping: { city: 'd', street: 't' } }).decls).toEqual([
      'Root',
      'Billing',
    ])
  })

  it('prefixes the parent on a collision, then numbers', () => {
    expect(names({ item: { a: 1 }, order: { item: { b: 1 } }, other: { order: { c: 1 } } }).decls).toEqual(
      ['Root', 'Item', 'Order', 'OrderItem', 'Other', 'OtherOrder'],
    )
    expect(names({ b: { x: 1 }, a_b: { z: 1 }, a: { b: { y: 1 } } }).decls).toEqual([
      'Root',
      'B',
      'AB',
      'A',
      'AB2',
    ])
  })

  it('makes a root array of objects the root type, plus a List alias', () => {
    expect(names([{ id: 1 }], 'go', 'user')).toEqual({ alias: 'UserList', decls: ['User'] })
  })

  it('aliases a primitive, map or mixed root', () => {
    expect(names('x')).toEqual({ alias: 'Root', decls: [] })
    expect(names({})).toEqual({ alias: 'Root', decls: [] })
    expect(names([1, 2])).toEqual({ alias: 'Root', decls: [] })
  })

  it('treats `{}` as a map, never as a named empty type', () => {
    expect(names({ meta: {} }).decls).toEqual(['Root'])
  })
})
