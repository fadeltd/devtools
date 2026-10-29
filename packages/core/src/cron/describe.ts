import { toString as cronstrueToString } from 'cronstrue'
import type { CronSchedule, RebootSchedule } from './parse.ts'

export interface DescribeOptions {
  /** `14:30` rather than `02:30 PM`. Default false. */
  use24HourTimeFormat?: boolean
}

export type DescribeResult = { ok: true; text: string } | { ok: false; error: { code: 'describe'; message: string } }

/**
 * The schedule as an English sentence, by cronstrue.
 *
 * It is given the parsed 5- or 6-field form, never the raw input: our parser
 * has already rejected what crond would, and expanded macros, so cronstrue
 * only has to phrase it. cronstrue still throws on input it dislikes, and that
 * comes back as data rather than reaching the UI.
 */
export function describeCron(s: CronSchedule | RebootSchedule, opts: DescribeOptions = {}): DescribeResult {
  if (s.kind === 'reboot') return { ok: true, text: 'Once, when the cron daemon starts (usually at boot)' }
  try {
    const text = cronstrueToString(s.expression, {
      use24HourTimeFormat: opts.use24HourTimeFormat === true,
      throwExceptionOnParseError: true,
      locale: 'en',
      // Standard cron numbers weekdays from 0 (Sunday) and months from 1, which
      // are cronstrue's defaults; say so rather than rely on them.
      dayOfWeekStartIndexZero: true,
      monthStartIndexZero: false,
    })
    return { ok: true, text }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: { code: 'describe', message: `Couldn't describe this expression: ${message}` } }
  }
}
