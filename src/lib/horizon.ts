// The observing site's real skyline — trees, buildings, hills — as an azimuth
// to altitude profile. Owns N.I.N.A.'s .hrz format and the geometry that goes
// with it. Pure: no I/O and no framework imports, so it is unit-testable.
import type { AltAzPoint } from './ephemeris'

export interface HorizonPoint {
  az: number   // whole degrees, 0-359, true north
  alt: number  // degrees above the mathematical horizon, 0-90
}

export interface HorizonProfile {
  points: HorizonPoint[]  // ascending by az, unique az, at least 2
  name: string | null     // source filename, shown in the editor toolbar
}

export interface ParseResult {
  profile: HorizonProfile | null
  warnings: string[]
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Whole degrees in [0, 360). 360 is the same direction as 0, so it collapses. */
export function normAz(azDeg: number): number {
  return ((Math.round(azDeg) % 360) + 360) % 360
}

/**
 * Nearest whole-degree azimuth to `azDeg` that isn't already taken by
 * `others` — used while dragging a point horizontally so it can't land
 * exactly on a neighbor's azimuth, which would otherwise silently replace
 * that neighbor (setPoint treats a same-azimuth point as a replacement).
 */
export function nearestFreeAz(others: number[], azDeg: number): number {
  const az = normAz(azDeg)
  if (!others.includes(az)) return az
  for (let d = 1; d < 360; d++) {
    const up = normAz(az + d)
    if (!others.includes(up)) return up
    const down = normAz(az - d)
    if (!others.includes(down)) return down
  }
  return az
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Parses N.I.N.A.'s .hrz format: one "azimuth altitude" pair per line, '#'
 * comments, ascending azimuth, gaps interpolated, minimum two pairs.
 *
 * Deliberately lenient — a horizon someone surveyed by hand should not be
 * rejected over a stray line — but every repair is reported so the UI can say
 * exactly what it did rather than silently changing the user's data.
 */
export function parseHrz(text: string, name: string | null = null): ParseResult {
  const byAz = new Map<number, number>()
  const warnings: string[] = []
  let malformed = 0
  let duplicates = 0
  let clamped = 0

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    const parts = line.split(/[\s,]+/).filter(Boolean)
    if (parts.length < 2) { malformed++; continue }
    const az = Number(parts[0])
    const alt = Number(parts[1])
    if (!isFinite(az) || !isFinite(alt)) { malformed++; continue }
    const key = normAz(az)
    const value = clamp(alt, 0, 90)
    if (value !== alt) clamped++
    // A file closing the loop by restating az 0 at az 360 with the same
    // altitude is normal (the real N.I.N.A. example does exactly this) — only
    // a genuinely conflicting value at the same azimuth is worth a warning.
    if (byAz.has(key) && byAz.get(key) !== value) duplicates++
    byAz.set(key, value)  // last one wins
  }

  const points = Array.from(byAz, ([az, alt]) => ({ az, alt })).sort((a, b) => a.az - b.az)

  if (malformed > 0) warnings.push(`skipped ${plural(malformed, 'malformed line')}`)
  if (duplicates > 0) warnings.push(`merged ${plural(duplicates, 'duplicate azimuth')}`)
  if (clamped > 0) warnings.push(`clamped ${plural(clamped, 'altitude')} into 0-90°`)

  if (points.length < 2) {
    warnings.push('a horizon needs at least two azimuth/altitude pairs')
    return { profile: null, warnings }
  }
  return { profile: { points, name }, warnings }
}

/** Serialises back to .hrz so the file round-trips into N.I.N.A. and Stellarium. */
export function formatHrz(profile: HorizonProfile): string {
  const lines = profile.points.map((p) => `${p.az} ${Number(p.alt.toFixed(2))}`)
  return ['# Az Alt', ...lines].join('\n') + '\n'
}

/**
 * Obstruction altitude at any azimuth, interpolating linearly between the
 * stored points and wrapping across the 0/360 seam — the segment from the last
 * point round to the first is just as real as the ones in between.
 */
export function horizonAltAt(profile: HorizonProfile, azDeg: number): number {
  const pts = profile.points
  const az = ((azDeg % 360) + 360) % 360
  const first = pts[0]
  const last = pts[pts.length - 1]

  if (az < first.az || az >= last.az) {
    const span = first.az + 360 - last.az
    if (span === 0) return last.alt
    const along = az >= last.az ? az - last.az : az + 360 - last.az
    return last.alt + ((first.alt - last.alt) * along) / span
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (az >= a.az && az <= b.az) {
      if (b.az === a.az) return b.alt
      return a.alt + ((b.alt - a.alt) * (az - a.az)) / (b.az - a.az)
    }
  }
  return last.alt
}

/** Adds or replaces the point at `azDeg` (snapped to a whole degree). */
export function setPoint(profile: HorizonProfile, azDeg: number, altDeg: number): HorizonProfile {
  const az = normAz(azDeg)
  const points = profile.points.filter((p) => p.az !== az)
  points.push({ az, alt: clamp(altDeg, 0, 90) })
  points.sort((a, b) => a.az - b.az)
  return { ...profile, points }
}

/** Removes a point, refusing to drop below the two a profile needs. */
export function removePoint(profile: HorizonProfile, azDeg: number): HorizonProfile {
  if (profile.points.length <= 2) return profile
  const az = normAz(azDeg)
  const points = profile.points.filter((p) => p.az !== az)
  return points.length === profile.points.length ? profile : { ...profile, points }
}

/** Validates a value loaded from settings; anything malformed means "no horizon". */
export function isHorizonProfile(value: unknown): value is HorizonProfile {
  if (typeof value !== 'object' || value === null) return false
  const points = (value as HorizonProfile).points
  return Array.isArray(points)
    && points.length >= 2
    && points.every((p) => typeof p === 'object' && p !== null
      && typeof (p as HorizonPoint).az === 'number'
      && typeof (p as HorizonPoint).alt === 'number')
}

export interface VisibilityWindow { start: Date; end: Date }

/** Height of the object above the skyline: positive means actually observable. */
function clearance(p: AltAzPoint, profile: HorizonProfile | null): number {
  return p.alt - (profile ? horizonAltAt(profile, p.az) : 0)
}

/** Time at which clearance crosses zero between two samples, found by linear
 *  interpolation — altitude is near enough linear over a 10-minute step that
 *  this lands well inside a minute. */
function crossingTime(a: AltAzPoint, b: AltAzPoint, profile: HorizonProfile | null): Date {
  const ca = clearance(a, profile)
  const cb = clearance(b, profile)
  const span = ca - cb
  const frac = span === 0 ? 0.5 : clamp(ca / span, 0, 1)
  return new Date(a.time.getTime() + (b.time.getTime() - a.time.getTime()) * frac)
}

/**
 * The intervals in which the object stands above the skyline. With no profile
 * this degenerates to the usual "above 0 degrees" windows. A target can have
 * several: dipping behind a building and reappearing is exactly what a custom
 * horizon is for.
 */
export function visibilityWindows(
  curve: AltAzPoint[], profile: HorizonProfile | null,
): VisibilityWindow[] {
  if (curve.length < 2) return []
  const windows: VisibilityWindow[] = []
  let start: Date | null = clearance(curve[0], profile) > 0 ? curve[0].time : null

  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]
    const cur = curve[i]
    const before = clearance(prev, profile)
    const after = clearance(cur, profile)
    if (before <= 0 && after > 0) {
      start = crossingTime(prev, cur, profile)
    } else if (before > 0 && after <= 0 && start !== null) {
      windows.push({ start, end: crossingTime(prev, cur, profile) })
      start = null
    }
  }
  if (start !== null) windows.push({ start, end: curve[curve.length - 1].time })
  return windows
}

/**
 * Does the object ever clear the skyline while the sun is down? This is the
 * question the Planner list asks: an object that only clears the treeline in
 * daylight is not worth listing as available tonight.
 *
 * `sunAltitudes` must be sampled over the same window and step as `curve`
 * (ephemeris.sunAltitudes with the same dayStart does exactly that).
 */
export function clearsHorizonAtNight(
  curve: AltAzPoint[], sunAltitudes: { alt: number }[], profile: HorizonProfile | null,
): boolean {
  const n = Math.min(curve.length, sunAltitudes.length)
  for (let i = 0; i < n; i++) {
    if (sunAltitudes[i].alt > 0) continue
    if (clearance(curve[i], profile) > 0) return true
  }
  return false
}
