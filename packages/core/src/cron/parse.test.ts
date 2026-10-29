import { describe, expect, it } from 'vitest'
import { parseCron, type CronError, type CronSchedule, type FieldName } from './parse.ts'

function schedule(input: string): CronSchedule {
  const r = parseCron(input)
  if (!r.ok) throw new Error(`expected ${input} to parse: ${r.error.message}`)
  if (r.value.kind !== 'schedule') throw new Error(`expected ${input} to be a schedule`)
  return r.value
}

function values(input: string, name: FieldName): number[] {
  const f = schedule(input).fields.find((x) => x.name === name)
  if (f === undefined) throw new Error(`no ${name} field`)
  return f.values
}

function error(input: string): CronError {
  const r = parseCron(input)
  if (r.ok) throw new Error(`expected ${input} to fail`)
  return r.error
}

const range = (from: number, to: number, step = 1) => {
  const out: number[] = []
  for (let v = from; v <= to; v += step) out.push(v)
  return out
}

describe('parseCron: syntax forms', () => {
  it('reads five fields in order', () => {
    const s = schedule('5 4 3 2 1')
    expect(s.fields.map((f) => [f.name, f.values])).toEqual([
      ['minute', [5]],
      ['hour', [4]],
      ['dayOfMonth', [3]],
      ['month', [2]],
      ['dayOfWeek', [1]],
    ])
    expect(s.hasSeconds).toBe(false)
    expect(s.expression).toBe('5 4 3 2 1')
  })

  it('expands * to the whole field', () => {
    expect(values('* * * * *', 'minute')).toEqual(range(0, 59))
    expect(values('* * * * *', 'hour')).toEqual(range(0, 23))
    expect(values('* * * * *', 'dayOfMonth')).toEqual(range(1, 31))
    expect(values('* * * * *', 'month')).toEqual(range(1, 12))
    expect(values('* * * * *', 'dayOfWeek')).toEqual(range(0, 6))
  })

  it('reads lists, ranges and steps', () => {
    expect(values('1,5,30 * * * *', 'minute')).toEqual([1, 5, 30])
    expect(values('10-15 * * * *', 'minute')).toEqual(range(10, 15))
    expect(values('*/15 * * * *', 'minute')).toEqual([0, 15, 30, 45])
    expect(values('1-10/2 * * * *', 'minute')).toEqual([1, 3, 5, 7, 9])
    expect(values('0 */6 * * *', 'hour')).toEqual([0, 6, 12, 18])
    expect(values('0 0 */10 * *', 'dayOfMonth')).toEqual([1, 11, 21, 31])
    expect(values('0,30,1-3,*/20 * * * *', 'minute')).toEqual([0, 1, 2, 3, 20, 30, 40])
  })

  it('reads a/step as "from a to the end of the field"', () => {
    expect(values('5/15 * * * *', 'minute')).toEqual([5, 20, 35, 50])
  })

  it('tolerates extra whitespace, including tabs', () => {
    expect(schedule('  */5\t*  * * *  ').expression).toBe('*/5 * * * *')
  })

  it('reads month and weekday names in any case', () => {
    expect(values('0 0 * JAN,mar,Dec *', 'month')).toEqual([1, 3, 12])
    expect(values('0 0 * * MON-FRI', 'dayOfWeek')).toEqual([1, 2, 3, 4, 5])
    expect(values('0 0 * * mon-fri', 'dayOfWeek')).toEqual([1, 2, 3, 4, 5])
    expect(values('0 0 * jan-jun/2 *', 'month')).toEqual([1, 3, 5])
  })

  it('treats day-of-week 7 as Sunday', () => {
    expect(values('0 0 * * 7', 'dayOfWeek')).toEqual([0])
    expect(values('0 0 * * 5-7', 'dayOfWeek')).toEqual([0, 5, 6])
    expect(values('0 0 * * 0-7', 'dayOfWeek')).toEqual(range(0, 6))
  })

  it('reads MON-SUN as the whole week rather than a backwards range', () => {
    expect(values('0 0 * * MON-SUN', 'dayOfWeek')).toEqual(range(0, 6))
    expect(values('0 0 * * FRI-SUN', 'dayOfWeek')).toEqual([0, 5, 6])
  })

  it('reads six fields as seconds first', () => {
    const s = schedule('*/10 0 12 * * MON')
    expect(s.hasSeconds).toBe(true)
    expect(s.fields.map((f) => f.name)).toEqual(['second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'])
    expect(values('*/10 0 12 * * MON', 'second')).toEqual([0, 10, 20, 30, 40, 50])
  })

  it('records where each field starts', () => {
    expect(schedule(' 0  12 * * *').fields.map((f) => f.start)).toEqual([1, 4, 7, 9, 11])
  })

  it('describes each field on its own', () => {
    const meanings = schedule('*/15 9-17 1,15 JAN-MAR MON-FRI').fields.map((f) => f.meaning)
    expect(meanings).toEqual([
      'every 15 minutes',
      'hours 9 through 17',
      'day 1, day 15',
      'January through March',
      'Monday through Friday',
    ])
    expect(schedule('0 0 * * 7').fields[4]?.meaning).toBe('Sunday')
    expect(schedule('0 1-11/2 * * *').fields[1]?.meaning).toBe('every 2 hours from 1 through 11')
    expect(schedule('5/15 * * * *').fields[0]?.meaning).toBe('every 15 minutes starting at 5')
  })
})

describe('parseCron: macros', () => {
  it.each([
    ['@yearly', '0 0 1 1 *'],
    ['@annually', '0 0 1 1 *'],
    ['@monthly', '0 0 1 * *'],
    ['@weekly', '0 0 * * 0'],
    ['@daily', '0 0 * * *'],
    ['@midnight', '0 0 * * *'],
    ['@hourly', '0 * * * *'],
    ['@HOURLY', '0 * * * *'],
  ])('expands %s to %s', (macro, expansion) => {
    const s = schedule(macro)
    expect(s.expression).toBe(expansion)
    expect(s.macro).toBe(macro.toLowerCase())
    expect(s.fields.every((f) => f.start === -1)).toBe(true)
  })

  it('reports @reboot as having no schedule', () => {
    const r = parseCron('@reboot')
    expect(r).toEqual({ ok: true, value: { kind: 'reboot', source: '@reboot', macro: '@reboot' } })
  })

  it('rejects an unknown macro', () => {
    expect(error('@fortnightly')).toMatchObject({ code: 'macro', field: null, position: 0 })
  })

  it('rejects anything after a macro', () => {
    expect(error('@daily /usr/bin/backup')).toMatchObject({ code: 'field-count', position: 7 })
  })
})

describe('parseCron: day-of-month and day-of-week', () => {
  it('ORs the day fields when both are restricted (Vixie)', () => {
    const s = schedule('0 0 13 * FRI')
    expect(s.dayOr).toBe(true)
    expect(s.notes.join(' ')).toMatch(/either one/)
  })

  it('ANDs them when either is *', () => {
    expect(schedule('0 0 13 * *').dayOr).toBe(false)
    expect(schedule('0 0 * * FRI').dayOr).toBe(false)
    expect(schedule('0 0 * * *').notes).toEqual([])
  })

  it('counts a field starting with * as unrestricted even when stepped, and says so', () => {
    const s = schedule('0 0 */2 * MON')
    expect(s.dayOr).toBe(false)
    expect(s.notes.join(' ')).toMatch(/Day of month starts with "\*".*both/)
  })
})

describe('parseCron: notes', () => {
  it('flags a step that only ever matches once', () => {
    expect(schedule('*/90 * * * *').notes.join(' ')).toMatch(/A step of 90 only matches minute 0.*restart every hour/)
    expect(schedule('0 */30 * * *').notes.join(' ')).toMatch(/hour 0/)
    expect(schedule('*/15 * * * *').notes).toEqual([])
  })
})

describe('parseCron: errors carry their field and position', () => {
  it.each<[string, Partial<CronError>]>([
    ['', { code: 'empty', field: null, position: 0 }],
    ['   ', { code: 'empty', field: null, position: 0 }],
    ['* * * *', { code: 'field-count', field: null, position: 7 }],
    ['* * * * * * * *', { code: 'field-count', field: null, position: 12 }],
    ['60 * * * *', { code: 'out-of-range', field: 'minute', position: 0 }],
    ['* 24 * * *', { code: 'out-of-range', field: 'hour', position: 2 }],
    ['* * 0 * *', { code: 'out-of-range', field: 'dayOfMonth', position: 4 }],
    ['* * 32 * *', { code: 'out-of-range', field: 'dayOfMonth', position: 4 }],
    ['* * * 13 *', { code: 'out-of-range', field: 'month', position: 6 }],
    ['* * * * 8', { code: 'out-of-range', field: 'dayOfWeek', position: 8 }],
    ['60 * * * * *', { code: 'out-of-range', field: 'second', position: 0 }],
    ['0 0-99 * * *', { code: 'out-of-range', field: 'hour', position: 4 }],
    ['*/0 * * * *', { code: 'step', field: 'minute', position: 2 }],
    ['*/ * * * *', { code: 'step', field: 'minute', position: 2 }],
    ['*/x * * * *', { code: 'step', field: 'minute', position: 2 }],
    ['/5 * * * *', { code: 'syntax', field: 'minute', position: 0 }],
    ['*/5/2 * * * *', { code: 'syntax', field: 'minute', position: 3 }],
    ['30-10 * * * *', { code: 'range', field: 'minute', position: 0 }],
    ['0 0 * * FRI-MON', { code: 'range', field: 'dayOfWeek', position: 8 }],
    ['1,,2 * * * *', { code: 'syntax', field: 'minute', position: 2 }],
    ['1, * * * *', { code: 'syntax', field: 'minute', position: 2 }],
    ['1.5 * * * *', { code: 'syntax', field: 'minute', position: 1 }],
    ['-5 * * * *', { code: 'syntax', field: 'minute', position: 0 }],
    ['1- * * * *', { code: 'syntax', field: 'minute', position: 2 }],
    ['0 0 * FOO *', { code: 'name', field: 'month', position: 6 }],
    ['0 0 * JANUARY *', { code: 'name', field: 'month', position: 6 }],
    ['0 0 * * FUNDAY', { code: 'name', field: 'dayOfWeek', position: 8 }],
    ['MON * * * *', { code: 'name', field: 'minute', position: 0 }],
    ['0 0 * * JAN', { code: 'name', field: 'dayOfWeek', position: 8 }],
  ])('%j', (input, expected) => {
    expect(error(input)).toMatchObject(expected)
  })

  it('names the field in the message', () => {
    expect(error('* 24 * * *').message).toBe('Hour 24 is out of range (0–23).')
    expect(error('*/0 * * * *').message).toMatch(/minute field/)
  })

  it('says a pasted crontab line has a command on the end', () => {
    expect(error('0 5 * * * /usr/bin/backup')).toMatchObject({ code: 'field-count', position: 10 })
    expect(error('0 5 * * * backup.sh --full')).toMatchObject({ code: 'field-count', position: 10 })
    expect(error('0 5 * * * echo hi').message).toMatch(/crontab line with a command/)
  })
})

describe('parseCron: Quartz syntax is refused by name', () => {
  it.each<[string, FieldName | null, number]>([
    ['0 0 ? * MON', 'dayOfMonth', 4],
    ['0 0 1 * ?', 'dayOfWeek', 8],
    ['0 0 L * *', 'dayOfMonth', 4],
    ['0 0 LW * *', 'dayOfMonth', 4],
    ['0 0 L-3 * *', 'dayOfMonth', 4],
    ['0 0 15W * *', 'dayOfMonth', 6],
    ['0 0 * * 5L', 'dayOfWeek', 9],
    ['0 0 * * FRIL', 'dayOfWeek', 11],
    ['0 0 * * 5#3', 'dayOfWeek', 9],
    ['0 0 * * MON#1', 'dayOfWeek', 11],
    ['0 0 12 ? * MON', 'dayOfMonth', 7],
    ['0 0 12 * * MON 2027', null, 15],
  ])('%j', (input, field, position) => {
    const e = error(input)
    expect(e).toMatchObject({ code: 'quartz', field, position })
    expect(e.message).toMatch(/^Quartz syntax isn't standard cron/)
  })

  it('still accepts names that contain L or W', () => {
    expect(values('0 0 * JUL *', 'month')).toEqual([7])
    expect(values('0 0 * * WED', 'dayOfWeek')).toEqual([3])
  })
})
