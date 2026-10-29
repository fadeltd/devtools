import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../random/random.ts'
import { inspectId } from './inspect.ts'
import { ulid } from './ulid.ts'
import { uuidV4, uuidV7 } from './uuid.ts'

/** The instant RFC 9562's Appendix A vectors encode. */
const RFC_ISO = '2022-02-22T19:22:22.000Z'

describe('inspectId: UUIDs', () => {
  it('reads the RFC 9562 Appendix A vectors', () => {
    const v1 = inspectId('C232AB00-9414-11EC-B3C8-9F6BDECED846')
    expect(v1).toMatchObject({ kind: 'uuid', version: 1, variant: 'rfc9562', label: 'UUID v1' })
    expect(v1?.time?.iso).toBe(RFC_ISO)

    const v4 = inspectId('919108f7-52d1-4320-9bac-f847db4148a8')
    expect(v4).toMatchObject({ version: 4, variant: 'rfc9562' })
    expect(v4?.time).toBeUndefined()

    const v6 = inspectId('1EC9414C-232A-6B00-B3C8-9F6BDECED846')
    expect(v6).toMatchObject({ version: 6 })
    expect(v6?.time?.iso).toBe(RFC_ISO)

    const v7 = inspectId('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')
    expect(v7).toMatchObject({ version: 7, canonical: '017f22e2-79b0-7cc3-98c4-dc0c0c07398f' })
    expect(v7?.time?.iso).toBe(RFC_ISO)
  })

  it('reads ids this module generates', () => {
    expect(inspectId(uuidV4(mulberry32(1)))?.version).toBe(4)
    const v7 = inspectId(uuidV7({ now: () => Date.UTC(2030, 0, 1) }))
    expect(v7?.version).toBe(7)
    expect(v7?.time?.iso).toBe('2030-01-01T00:00:00.000Z')
  })

  it('recognises the nil and max UUIDs', () => {
    expect(inspectId('00000000-0000-0000-0000-000000000000')).toMatchObject({ special: 'nil', label: 'Nil UUID' })
    expect(inspectId('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')).toMatchObject({ special: 'max', label: 'Max UUID' })
  })

  it('reports a non-RFC variant without claiming a version', () => {
    // IUnknown, the original COM GUID.
    const r = inspectId('00000000-0000-0000-c000-000000000046')
    expect(r).toMatchObject({ kind: 'uuid', variant: 'microsoft' })
    expect(r?.version).toBeUndefined()
  })

  it('accepts no hyphens, braces and a urn:uuid: prefix', () => {
    const canonical = '919108f7-52d1-4320-9bac-f847db4148a8'
    for (const form of [
      '919108f752d143209bacf847db4148a8',
      `{${canonical}}`,
      `urn:uuid:${canonical}`,
      `  ${canonical.toUpperCase()}\n`,
    ]) {
      expect(inspectId(form)?.canonical, form).toBe(canonical)
    }
  })

  it('names an undefined version rather than guessing', () => {
    expect(inspectId('919108f7-52d1-0320-9bac-f847db4148a8')?.description).toMatch(/not one RFC 9562 defines/)
  })
})

describe('inspectId: ULIDs', () => {
  it('decodes the embedded time', () => {
    const r = inspectId('01ARYZ6S41TSV4RRFFQ69G5FAV')
    expect(r).toMatchObject({ kind: 'ulid', label: 'ULID', prefix: '' })
    expect(r?.time?.ms).toBe(1469918176385)
  })

  it('normalises a lowercase ULID to uppercase', () => {
    expect(inspectId('01aryz6s41tsv4rrffq69g5fav')?.canonical).toBe('01ARYZ6S41TSV4RRFFQ69G5FAV')
  })

  it('reads ids this module generates', () => {
    const ms = Date.UTC(2031, 5, 15, 12)
    expect(inspectId(ulid({ now: () => ms }))?.time?.ms).toBe(ms)
  })
})

describe('inspectId: prefixes', () => {
  it('splits off a prefix that ends in a separator', () => {
    expect(inspectId('user_01ARYZ6S41TSV4RRFFQ69G5FAV')).toMatchObject({ kind: 'ulid', prefix: 'user_' })
    expect(inspectId('cus-017f22e2-79b0-7cc3-98c4-dc0c0c07398f')).toMatchObject({ version: 7, prefix: 'cus-' })
    expect(inspectId('order:919108f752d143209bacf847db4148a8')).toMatchObject({ version: 4, prefix: 'order:' })
  })

  it('does not carve an id out of a longer alphanumeric token', () => {
    expect(inspectId('abc01ARYZ6S41TSV4RRFFQ69G5FAV')).toBeNull()
  })
})

describe('inspectId: not an id', () => {
  it('returns null for anything else', () => {
    for (const s of ['', '   ', 'hello', 'sk_live_abc', '919108f7-52d1-4320-9bac', '01ARYZ6S41TSV4RRFFQ69G5FAI']) {
      expect(inspectId(s), s).toBeNull()
    }
  })
})
