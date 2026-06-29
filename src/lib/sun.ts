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

/** 1-based day of the year for a Date (its local calendar date). */
export function dayOfYear(date: Date): number {
  // UTC date arithmetic avoids DST jitter: two local midnights an hour apart
  // across a DST boundary would otherwise floor to a day off.
  const start = Date.UTC(date.getFullYear(), 0, 0)
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((day - start) / 86_400_000)
}

function mod24(h: number): number {
  return ((h % 24) + 24) % 24
}

/** Equation of time in minutes (apparent solar time minus mean solar time). */
export function equationOfTimeMinutes(dayOfYear: number): number {
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b)
}

export type BandKind = 'crosses' | 'alwaysAbove' | 'alwaysBelow'

export interface DayPhases {
  // Local clock hours in [0,24), or null when the threshold is never reached that day.
  sunrise: number | null
  sunset: number | null
  civilDawn: number | null
  civilDusk: number | null
  nauticalDawn: number | null
  nauticalDusk: number | null
  astroDawn: number | null
  astroDusk: number | null
  // Crossing kind per threshold [0, -6, -12, -18]; lets the chart fill polar columns:
  // 'alwaysBelow' = darker than this all day (fill), 'alwaysAbove' = never this dark (collapse).
  bandKinds: [BandKind, BandKind, BandKind, BandKind]
  nightCenter: number // clock hour of local solar midnight (band centre / collapse point)
  daylightHours: number | null // sunset − sunrise; null when polar day/night
  darkHours: number // astronomical-night length (astroDusk→astroDawn); 0 when none
  sunUpAllDay: boolean // polar day (horizon alwaysAbove)
  sunDownAllDay: boolean // polar night (horizon alwaysBelow)
}

/**
 * Local clock-time sun phases for one day. Pure: the DST-aware tzOffsetHours is
 * supplied by the caller (see timezone.ts). Times are clock hours in [0,24).
 */
export function dayPhases(
  latDeg: number,
  lonDeg: number,
  dayOfYear: number,
  tzOffsetHours: number,
): DayPhases {
  const shift = -equationOfTimeMinutes(dayOfYear) / 60 - lonDeg / 15 + tzOffsetHours
  const toClock = (solar: number) => mod24(solar + shift)

  const at = (altDeg: number) => {
    const c = altitudeCrossing(latDeg, dayOfYear, altDeg)
    if (c.kind === 'crosses') {
      return { dawn: toClock(c.morning), dusk: toClock(c.evening), kind: 'crosses' as BandKind }
    }
    return { dawn: null, dusk: null, kind: c.kind as BandKind }
  }

  const b0 = at(0)
  const b6 = at(-6)
  const b12 = at(-12)
  const b18 = at(-18)

  return {
    sunrise: b0.dawn,
    sunset: b0.dusk,
    civilDawn: b6.dawn,
    civilDusk: b6.dusk,
    nauticalDawn: b12.dawn,
    nauticalDusk: b12.dusk,
    astroDawn: b18.dawn,
    astroDusk: b18.dusk,
    bandKinds: [b0.kind, b6.kind, b12.kind, b18.kind],
    nightCenter: toClock(24),
    daylightHours: b0.dusk !== null && b0.dawn !== null ? mod24(b0.dusk - b0.dawn) : null,
    darkHours: b18.dusk !== null && b18.dawn !== null ? mod24(b18.dawn - b18.dusk) : 0,
    sunUpAllDay: b0.kind === 'alwaysAbove',
    sunDownAllDay: b0.kind === 'alwaysBelow',
  }
}
