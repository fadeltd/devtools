import { describe, expect, it } from 'vitest'
import { parseLossless } from '../json/rawjson.ts'
import { inferShape, MAX_DEPTH } from './shape.ts'

const infer = (...samples: unknown[]) => inferShape(samples).shape

describe('inferShape', () => {
  it('records each kind once', () => {
    const s = infer('a', 'b', true, null)
    expect(s).toMatchObject({ string: true, boolean: true, null: true, integer: null, number: false })
  })

  it('tells integers from floats by their literal', () => {
    expect(infer(parseLossless('1')).integer).toBe('safe')
    expect(infer(parseLossless('1.0')).number).toBe(true)
    expect(infer(parseLossless('1e5')).number).toBe(true)
    expect(infer(parseLossless('1e5')).integer).toBe(null)
    expect(infer(parseLossless('-0')).integer).toBe('safe')
  })

  it('records the widest integer', () => {
    expect(infer(parseLossless('9007199254740992')).integer).toBe('int64')
    expect(infer(parseLossless('-9223372036854775808')).integer).toBe('int64')
    expect(infer(parseLossless('9223372036854775808')).integer).toBe('uint64')
    expect(infer(parseLossless('18446744073709551616')).integer).toBe('big')
    expect(infer(1, parseLossless('9223372036854775808'), 2).integer).toBe('uint64')
  })

  it('counts keys so a missing one is optional', () => {
    const s = infer({ a: 1, b: 2 }, { a: 3 })
    expect(s.object!.samples).toBe(2)
    expect(s.object!.fields.get('a')!.count).toBe(2)
    expect(s.object!.fields.get('b')!.count).toBe(1)
  })

  it('merges every array element into one item shape', () => {
    const s = infer([{ a: 1 }, { a: 'x', b: true }])
    const item = s.array!.items.object!
    expect(item.samples).toBe(2)
    expect(item.fields.get('a')!.shape).toMatchObject({ integer: 'safe', string: true })
  })

  it('keeps hostile keys as data', () => {
    const s = infer(JSON.parse('{"__proto__": 1, "constructor": "x"}'))
    expect([...s.object!.fields.keys()]).toEqual(['__proto__', 'constructor'])
  })

  it('stops at the depth cap and says where', () => {
    let deep: unknown = 1
    for (let i = 0; i < MAX_DEPTH + 50; i++) deep = [deep]
    const { shape, truncatedAt } = inferShape([deep])
    expect(truncatedAt).toBe('[]'.repeat(MAX_DEPTH))
    let s = shape
    for (let i = 0; i < MAX_DEPTH; i++) s = s.array!.items
    expect(s.unknown).toBe(true)
  })
})
