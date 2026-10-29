import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  describeMode,
  formatLike,
  fromBits,
  parsePermissions,
  type PermMatrix,
  type Permissions,
} from './perms.ts'

const perms = (input: string): Permissions => {
  const r = parsePermissions(input)
  if (!r.ok) throw new Error(r.error.message)
  return r
}

describe('parsePermissions: octal', () => {
  it('reads 3 and 4 digit modes', () => {
    expect(perms('755')).toMatchObject({ mode: 0o755, octal: '755', symbolic: 'rwxr-xr-x' })
    expect(perms('0755')).toMatchObject({ mode: 0o755, octal: '755' })
    expect(perms('0o644')).toMatchObject({ mode: 0o644, symbolic: 'rw-r--r--' })
    expect(perms('00755').mode).toBe(0o755)
    expect(perms('7').symbolic).toBe('------rwx')
    expect(perms('0').symbolic).toBe('---------')
  })

  it('reads the special bits', () => {
    expect(perms('4755')).toMatchObject({
      octal: '4755',
      symbolic: 'rwsr-xr-x',
      special: { setuid: true, setgid: false, sticky: false },
    })
    expect(perms('2755').symbolic).toBe('rwxr-sr-x')
    expect(perms('1777').symbolic).toBe('rwxrwxrwt')
    expect(perms('7000').symbolic).toBe('--S--S--T')
  })

  it('rejects 8 and 9 at their index', () => {
    expect(parsePermissions('758')).toEqual({
      ok: false,
      error: { code: 'invalid-digit', message: '8 is not an octal digit (0–7).', index: 2, char: '8' },
    })
    expect(parsePermissions(' 79')).toMatchObject({ ok: false, error: { index: 2, char: '9' } })
    expect(parsePermissions('75x')).toMatchObject({ ok: false, error: { code: 'invalid-digit', index: 2 } })
  })

  it('rejects more than 4 significant digits', () => {
    expect(parsePermissions('17777')).toMatchObject({ ok: false, error: { code: 'too-long' } })
  })

  it('rejects empty input', () => {
    expect(parsePermissions('  ')).toMatchObject({ ok: false, error: { code: 'empty' } })
    expect(parsePermissions('0o')).toMatchObject({ ok: false, error: { code: 'empty' } })
  })
})

describe('parsePermissions: symbolic', () => {
  it('reads the 9-character form', () => {
    expect(perms('rwxr-xr-x')).toMatchObject({ mode: 0o755, fileType: null })
    expect(perms('rw-r-----').octal).toBe('640')
  })

  it('reads ls -l, with the type character and trailing markers', () => {
    expect(perms('-rwxr-xr-x')).toMatchObject({ mode: 0o755, fileType: '-' })
    expect(perms('drwxr-xr-t')).toMatchObject({ mode: 0o1755, fileType: 'd', octal: '1755' })
    expect(perms('-rw-r--r--@').mode).toBe(0o644)
    expect(perms('drwxr-xr-x+').fileType).toBe('d')
    expect(perms('lrwxrwxrwx').fileType).toBe('l')
  })

  it('tells s from S and t from T', () => {
    expect(perms('rwsr-xr-x').mode).toBe(0o4755)
    expect(perms('rwSr-xr-x').mode).toBe(0o4655)
    expect(perms('rwxr-sr-x').mode).toBe(0o2755)
    expect(perms('rwxr-Sr-x').mode).toBe(0o2745)
    expect(perms('rwxrwxrwt').mode).toBe(0o1777)
    expect(perms('rwxrwxrwT').mode).toBe(0o1776)
  })

  it('rejects the wrong length', () => {
    expect(parsePermissions('rwxr-xr')).toMatchObject({ ok: false, error: { code: 'wrong-length', index: 7 } })
    expect(parsePermissions('drwxr-xr-x+ x')).toMatchObject({ ok: false, error: { code: 'wrong-length', index: 11 } })
  })

  it('rejects a bad character at its index', () => {
    expect(parsePermissions('rwxr-xr-q')).toMatchObject({
      ok: false,
      error: { code: 'invalid-char', index: 8, char: 'q', message: 'Expected “x”, “t”, “T” or “-” here, found “q”.' },
    })
    expect(parsePermissions('rwxrwxrws')).toMatchObject({ ok: false, error: { index: 8, char: 's' } })
    expect(parsePermissions('rwtr-xr-x')).toMatchObject({ ok: false, error: { index: 2 } })
    expect(parsePermissions('wrxr-xr-x')).toMatchObject({ ok: false, error: { index: 0 } })
    expect(parsePermissions('xrwxr-xr-x')).toMatchObject({ ok: false, error: { index: 0, char: 'x' } })
    expect(parsePermissions('-rwxr-xr-x!')).toMatchObject({ ok: false, error: { index: 10, char: '!' } })
    expect(parsePermissions('  RWXR-XR-X')).toMatchObject({ ok: false, error: { index: 2, char: 'R' } })
  })
})

describe('round trips', () => {
  const ALL = Array.from({ length: 0o10000 }, (_, m) => m)

  it('all 4096 modes go octal → symbolic → octal', () => {
    for (const mode of ALL) {
      const a = perms(mode.toString(8))
      expect(a.mode).toBe(mode)
      const b = perms(a.symbolic)
      expect(b.mode).toBe(mode)
      expect(b.octal).toBe(a.octal)
      expect(perms(`d${a.symbolic}`).mode).toBe(mode)
      expect(perms(a.octal).mode).toBe(mode)
    }
  })

  it('all 4096 modes survive the checkbox grid', () => {
    for (const mode of ALL) {
      const p = describeMode(mode)
      expect(fromBits(p.matrix, p.special).mode).toBe(mode)
    }
  })

  it('fromBits builds what the grid shows', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), (b) => {
        const matrix = [b.slice(0, 3), b.slice(3, 6), b.slice(6, 9)] as PermMatrix
        const special = { setuid: b[9] === true, setgid: b[10] === true, sticky: b[11] === true }
        const p = fromBits(matrix, special)
        expect(p.matrix).toEqual(matrix)
        expect(p.special).toEqual(special)
      }),
    )
  })
})

describe('chmod commands', () => {
  it('gives both forms', () => {
    expect(perms('755').chmod).toEqual({ octal: 'chmod 755 file', symbolic: 'chmod u=rwx,g=rx,o=rx file' })
    expect(perms('640').chmod.symbolic).toBe('chmod u=rw,g=r,o= file')
    expect(perms('4755').chmod).toEqual({ octal: 'chmod 4755 file', symbolic: 'chmod u=rwxs,g=rx,o=rx file' })
    expect(perms('1777').chmod.symbolic).toBe('chmod u=rwx,g=rwx,o=rwxt file')
    expect(perms('2640').chmod.symbolic).toBe('chmod u=rw,g=rs,o= file')
  })
})

describe('formatLike', () => {
  const p = describeMode(0o750, 'd')
  it('keeps the format the user was typing', () => {
    expect(formatLike('755', p)).toBe('750')
    expect(formatLike('', p)).toBe('750')
    expect(formatLike('rwxr-xr-x', describeMode(0o750))).toBe('rwxr-x---')
    expect(formatLike('drwxr-xr-x', p)).toBe('drwxr-x---')
  })
})
