import { describe, expect, it } from 'vitest'
import { describeCron } from './describe.ts'
import { parseCron, type CronSchedule, type RebootSchedule } from './parse.ts'

function parsed(input: string): CronSchedule | RebootSchedule {
  const r = parseCron(input)
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

const text = (input: string, use24HourTimeFormat = false) => {
  const r = describeCron(parsed(input), { use24HourTimeFormat })
  if (!r.ok) throw new Error(r.error.message)
  return r.text
}

describe('describeCron', () => {
  it('phrases common schedules', () => {
    expect(text('*/15 * * * *')).toBe('Every 15 minutes')
    expect(text('* * * * *')).toBe('Every minute')
    expect(text('0 9 * * MON-FRI')).toBe('At 09:00 AM, Monday through Friday')
  })

  it('uses a 24-hour clock on request', () => {
    expect(text('30 14 * * *')).toBe('At 02:30 PM')
    expect(text('30 14 * * *', true)).toBe('At 14:30')
  })

  it('describes the expansion of a macro', () => {
    expect(text('@daily', true)).toBe('At 00:00')
    expect(text('@weekly', true)).toBe('At 00:00, only on Sunday')
  })

  it('reads day-of-week 7 as Sunday', () => {
    expect(text('0 0 * * 7', true)).toBe('At 00:00, only on Sunday')
  })

  it('describes seconds in a 6-field schedule', () => {
    expect(text('*/10 * * * * *')).toBe('Every 10 seconds')
  })

  it('describes @reboot without a time', () => {
    expect(text('@reboot')).toMatch(/when the cron daemon starts/)
  })

  it('returns a cronstrue failure as data', () => {
    const s = parsed('* * * * *') as CronSchedule
    const r = describeCron({ ...s, expression: 'not a cron expression at all' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('describe')
  })
})
