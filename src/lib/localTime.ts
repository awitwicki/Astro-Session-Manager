// Zone-aware time helpers for the Planner. All Planner UI times are shown in
// the observing location's IANA timezone, which may differ from the computer's.
import { tzOffsetHours } from './timezone'

/** UTC instant of 00:00 (midnight) of `date`'s calendar day in `timeZone`. */
export function localMidnight(date: Date, timeZone: string): Date {
  // en-CA formats as "YYYY-MM-DD"
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
  const [y, m, d] = ymd.split('-').map(Number)
  // Guess assuming UTC, then correct by the zone offset at that guess; the
  // second pass handles offsets that change right at midnight (DST edges).
  const utcGuess = Date.UTC(y, m - 1, d)
  const once = new Date(utcGuess - tzOffsetHours(timeZone, new Date(utcGuess)) * 3_600_000)
  return new Date(utcGuess - tzOffsetHours(timeZone, once) * 3_600_000)
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

/** Start of the 24h window (local noon) whose centered night — dusk of this
 *  day through dawn of the next — contains `date`. Feeding this into a chart
 *  instead of local midnight keeps the night in the middle of the plot
 *  rather than split across both edges. */
export function nightWindowStart(date: Date, timeZone: string): Date {
  const noon = addMinutes(localMidnight(date, timeZone), 12 * 60)
  if (date.getTime() >= noon.getTime()) return noon
  return addMinutes(localMidnight(addDays(date, -1), timeZone), 12 * 60)
}

export function formatTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(date)
}

export function formatDateTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date)
}
