// Solar-position math ported from src/lib/sun.ts. Pure, no DOM — Node's test
// runner imports this file, so keep browser globals out of it.
// altitudeCrossing works in LOCAL SOLAR TIME (solar noon = 12:00); dayPhases
// converts to clock time via equation-of-time, longitude, and the
// caller-supplied DST-aware timezone offset (see daylight.js).

const DEG = Math.PI / 180

/** Solar declination (degrees) for a 1-based day of year (standard cosine approximation). */
export function solarDeclinationDeg(dayOfYear) {
  return -23.44 * Math.cos((360 / 365) * (dayOfYear + 10) * DEG)
}

/**
 * Solar-time hours at which the sun passes `altDeg` (e.g. 0, -6, -12, -18),
 * descending in the evening and ascending in the morning, for a latitude/day.
 * Returns {kind:'crosses', morning, evening} | {kind:'alwaysAbove'} | {kind:'alwaysBelow'}.
 */
export function altitudeCrossing(latDeg, dayOfYear, altDeg) {
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

/** 1-based day of the year for a Date (its local calendar date). */
export function dayOfYear(date) {
  // UTC date arithmetic avoids DST jitter: two local midnights an hour apart
  // across a DST boundary would otherwise floor to a day off.
  const start = Date.UTC(date.getFullYear(), 0, 0)
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor((day - start) / 86_400_000)
}

function mod24(h) {
  return ((h % 24) + 24) % 24
}

/** Equation of time in minutes (apparent solar time minus mean solar time). */
export function equationOfTimeMinutes(dayOfYear) {
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b)
}

/**
 * Local clock-time sun phases for one day. Pure: the DST-aware tzOffsetHours is
 * supplied by the caller. Times are clock hours in [0,24).
 */
export function dayPhases(latDeg, lonDeg, dayOfYear, tzOffsetHours) {
  const shift = -equationOfTimeMinutes(dayOfYear) / 60 - lonDeg / 15 + tzOffsetHours
  const toClock = (solar) => mod24(solar + shift)

  const at = (altDeg) => {
    const c = altitudeCrossing(latDeg, dayOfYear, altDeg)
    if (c.kind === 'crosses') {
      return { dawn: toClock(c.morning), dusk: toClock(c.evening), kind: 'crosses' }
    }
    return { dawn: null, dusk: null, kind: c.kind }
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
