// Solar-position math for the Seasonal Daylight Chart.
// Pure, no I/O. All times are LOCAL SOLAR TIME with solar noon fixed at 12:00
// (equation-of-time, longitude, and DST are intentionally ignored — see spec).

const DEG = Math.PI / 180

/** Solar declination (degrees) for a 1-based day of year (standard cosine approximation). */
export function solarDeclinationDeg(dayOfYear: number): number {
  return -23.44 * Math.cos((360 / 365) * (dayOfYear + 10) * DEG)
}

export type CrossingResult =
  | { kind: 'crosses'; morning: number; evening: number } // solar hours in [0, 24]
  | { kind: 'alwaysAbove' } // sun never descends to altDeg (midnight sun, or never dark enough)
  | { kind: 'alwaysBelow' } // sun never rises to altDeg (polar night)

/**
 * Solar-time hours at which the sun passes `altDeg` (e.g. 0, -6, -12, -18),
 * descending in the evening and ascending in the morning, for a latitude/day.
 */
export function altitudeCrossing(latDeg: number, dayOfYear: number, altDeg: number): CrossingResult {
  const phi = latDeg * DEG
  const dec = solarDeclinationDeg(dayOfYear) * DEG
  const a = altDeg * DEG
  const cosH = (Math.sin(a) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))
  if (cosH > 1) return { kind: 'alwaysBelow' } // sun never reaches altDeg from below
  if (cosH < -1) return { kind: 'alwaysAbove' } // sun never descends to altDeg
  const H = Math.acos(cosH) / DEG // hour angle, degrees [0, 180]
  const half = H / 15 // hours from solar noon
  return { kind: 'crosses', morning: 12 - half, evening: 12 + half }
}

/** Altitude thresholds (deg) defining day/twilight/dark bands, outermost → innermost. */
export const THRESHOLDS = [0, -6, -12, -18] as const

/**
 * Evening solar-time crossing for each THRESHOLD (in [12, 24]), clamped so the
 * chart can paint nested bands:
 *  - crosses     -> 12 + H/15
 *  - alwaysAbove -> 24  (band collapses to midnight centre; e.g. no astro dark in summer)
 *  - alwaysBelow -> 12  (band fills up to noon; e.g. polar night)
 */
export function eveningCrossings(latDeg: number, dayOfYear: number): number[] {
  return THRESHOLDS.map((alt) => {
    const c = altitudeCrossing(latDeg, dayOfYear, alt)
    if (c.kind === 'crosses') return c.evening
    return c.kind === 'alwaysAbove' ? 24 : 12
  })
}

/** 1-based day of the year for a Date (its local calendar date). */
export function dayOfYear(date: Date): number {
  // UTC date arithmetic avoids DST jitter: two local midnights an hour apart
  // across a DST boundary would otherwise floor to a day off.
  const start = Date.UTC(date.getFullYear(), 0, 0)
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((day - start) / 86_400_000)
}
