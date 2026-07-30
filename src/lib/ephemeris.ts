// Ephemeris helpers for the Planner: thin wrappers over astronomy-engine.
// All RA/Dec parameters and results are J2000 degrees; observers at sea level.
import {
  Body, DefineStar, Equator, EquatorFromVector, Horizon, Illumination, MakeTime,
  MoonPhase, Observer, RotateVector, Rotation_HOR_EQJ, SearchHourAngle,
  SearchRiseSet, Spherical, VectorFromHorizon,
  type AstroTime, type RotationMatrix,
} from 'astronomy-engine'

export interface AltAz { alt: number; az: number }

// astronomy-engine models user-defined stars via global slots; all use here is
// synchronous, so reusing one slot is safe.
function targetBody(raDeg: number, decDeg: number): Body {
  DefineStar(Body.Star1, raDeg / 15, decDeg, 1000)
  return Body.Star1
}

export function altAzAt(raDeg: number, decDeg: number, date: Date, lat: number, lon: number): AltAz {
  const observer = new Observer(lat, lon, 0)
  const eq = Equator(targetBody(raDeg, decDeg), date, observer, true, true)
  const hor = Horizon(date, observer, eq.ra, eq.dec, 'normal')
  return { alt: hor.altitude, az: hor.azimuth }
}

export interface AltitudePoint { time: Date; alt: number }

export interface AltAzPoint { time: Date; alt: number; az: number }

/** Alt and az sampled across a 24h window. The az is what a custom horizon
 *  profile is indexed by, so anything horizon-aware needs this rather than
 *  altitudeCurve. */
export function altAzCurve(
  raDeg: number, decDeg: number, dayStart: Date, lat: number, lon: number, stepMinutes = 10,
): AltAzPoint[] {
  const points: AltAzPoint[] = []
  for (let min = 0; min <= 24 * 60; min += stepMinutes) {
    const time = new Date(dayStart.getTime() + min * 60_000)
    const { alt, az } = altAzAt(raDeg, decDeg, time, lat, lon)
    points.push({ time, alt, az })
  }
  return points
}

export function altitudeCurve(
  raDeg: number, decDeg: number, dayStart: Date, lat: number, lon: number, stepMinutes = 10,
): AltitudePoint[] {
  return altAzCurve(raDeg, decDeg, dayStart, lat, lon, stepMinutes)
    .map(({ time, alt }) => ({ time, alt }))
}

/** Azimuth of the target at each tick hour of the curve's 24h window, or null
 *  where the target sits below the mathematical horizon at that moment. */
export function azimuthTicks(curve: AltAzPoint[], tickHours: number[]): (number | null)[] {
  return tickHours.map((h) => {
    const i = Math.round((h / 24) * (curve.length - 1))
    const p = curve[Math.min(curve.length - 1, Math.max(0, i))]
    return p.alt >= 0 ? p.az : null
  })
}

export function sunAltitudes(dayStart: Date, lat: number, lon: number, stepMinutes = 10): AltitudePoint[] {
  const observer = new Observer(lat, lon, 0)
  const points: AltitudePoint[] = []
  for (let min = 0; min <= 24 * 60; min += stepMinutes) {
    const time = new Date(dayStart.getTime() + min * 60_000)
    const eq = Equator(Body.Sun, time, observer, true, true)
    points.push({ time, alt: Horizon(time, observer, eq.ra, eq.dec, 'normal').altitude })
  }
  return points
}

export type RiseTransitSet =
  | { kind: 'normal'; rise: Date | null; set: Date | null; transit: Date; transitAlt: number }
  | { kind: 'circumpolar'; transit: Date; transitAlt: number }
  | { kind: 'neverRises'; transit: Date; transitAlt: number }

export function riseTransitSet(
  raDeg: number, decDeg: number, dayStart: Date, lat: number, lon: number,
): RiseTransitSet {
  const observer = new Observer(lat, lon, 0)
  const body = targetBody(raDeg, decDeg)
  const rise = SearchRiseSet(body, observer, +1, dayStart, 1)
  const set = SearchRiseSet(body, observer, -1, dayStart, 1)
  const culmination = SearchHourAngle(body, observer, 0, dayStart, +1)
  const transit = culmination.time.date
  const transitAlt = culmination.hor.altitude
  if (rise === null && set === null) {
    return transitAlt > 0
      ? { kind: 'circumpolar', transit, transitAlt }
      : { kind: 'neverRises', transit, transitAlt }
  }
  return { kind: 'normal', rise: rise ? rise.date : null, set: set ? set.date : null, transit, transitAlt }
}

const PHASE_NAMES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
]

export interface MoonInfo {
  illumination: number // 0..1
  phaseName: string
  alt: number
  az: number
  raDeg: number
  decDeg: number
}

export function moonInfo(date: Date, lat: number, lon: number): MoonInfo {
  const observer = new Observer(lat, lon, 0)
  const eq = Equator(Body.Moon, date, observer, true, true)
  const hor = Horizon(date, observer, eq.ra, eq.dec, 'normal')
  const phaseLon = MoonPhase(date) // 0 = new, 90 = first quarter, 180 = full
  return {
    illumination: Illumination(Body.Moon, date).phase_fraction,
    phaseName: PHASE_NAMES[Math.round(phaseLon / 45) % 8],
    alt: hor.altitude,
    az: hor.azimuth,
    raDeg: eq.ra * 15,
    decDeg: eq.dec,
  }
}

const DEG = Math.PI / 180

export function separationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  // Haversine on the celestial sphere: numerically stable at small separations
  const a = Math.sin(((dec2 - dec1) * DEG) / 2) ** 2
    + Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.sin(((ra2 - ra1) * DEG) / 2) ** 2
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / DEG
}

function equatorialFromHorizontal(
  altDeg: number, azDeg: number, rot: RotationMatrix, time: AstroTime,
): [number, number] {
  const vec = VectorFromHorizon(new Spherical(altDeg, azDeg, 1), time, '')
  const eq = EquatorFromVector(RotateVector(rot, vec))
  return [eq.ra * 15, eq.dec]
}

/** J2000 RA/Dec points tracing a circle of constant altitude at `date` — an
 *  alt-az mount's "altitude ring" (alt = 0 is the horizon). Stops short of
 *  360° (not `<=`): az 0 and az 360 are the same point, and a coincident
 *  first/last sample makes downstream circle-fitting (fitShape's p1/p3 pick)
 *  degenerate — circleFrom3 sees two identical points, returns null, and the
 *  caller falls back to a spurious straight-line approximation of what is
 *  actually a small circle, rendering at the wrong angle and snapping
 *  direction as the nearest-to-center sample changes while panning. */
export function altitudeCircleJ2000(
  altDeg: number, date: Date, lat: number, lon: number, stepDeg = 5,
): [number, number][] {
  const observer = new Observer(lat, lon, 0)
  const time = MakeTime(date)
  const rot = Rotation_HOR_EQJ(time, observer)
  const points: [number, number][] = []
  for (let az = 0; az < 360; az += stepDeg) points.push(equatorialFromHorizontal(altDeg, az, rot, time))
  return points
}

/** J2000 RA/Dec points tracing a line of constant azimuth at `date` — an
 *  alt-az mount's "azimuth line", running from the horizon up to the zenith.
 *  Stops at the horizon: the below-horizon half is never drawn. */
export function azimuthLineJ2000(
  azDeg: number, date: Date, lat: number, lon: number, stepDeg = 5,
): [number, number][] {
  const observer = new Observer(lat, lon, 0)
  const time = MakeTime(date)
  const rot = Rotation_HOR_EQJ(time, observer)
  const points: [number, number][] = []
  for (let alt = 0; alt <= 90; alt += stepDeg) points.push(equatorialFromHorizontal(alt, azDeg, rot, time))
  return points
}

/** J2000 RA/Dec points tracing the local horizon at `date`. By default this is
 *  the flat geometric horizon (alt = 0); pass `altAt` to trace a custom skyline
 *  instead. The callback keeps this module unaware of horizon profiles. Stops
 *  short of 360° (not `<=`) for the same reason as altitudeCircleJ2000: a
 *  coincident first/last point degenerates fitShape's circle fit. */
export function horizonPathJ2000(
  date: Date, lat: number, lon: number, stepDeg = 5,
  altAt?: (azDeg: number) => number,
): [number, number][] {
  const observer = new Observer(lat, lon, 0)
  const time = MakeTime(date)
  const rot = Rotation_HOR_EQJ(time, observer)
  const points: [number, number][] = []
  for (let az = 0; az < 360; az += stepDeg) {
    points.push(equatorialFromHorizontal(altAt ? altAt(az % 360) : 0, az, rot, time))
  }
  return points
}

/** J2000 RA/Dec of the local zenith (alt = 90) at `date`. Always in the sky,
 *  so it identifies which side of the horizon is sky and which is ground. */
export function zenithEquatorial(date: Date, lat: number, lon: number): [number, number] {
  const observer = new Observer(lat, lon, 0)
  const time = MakeTime(date)
  return equatorialFromHorizontal(90, 0, Rotation_HOR_EQJ(time, observer), time)
}

/** J2000 RA/Dec of the point at (azDeg, altDeg) in the local sky at `date` —
 *  the single-direction inverse of altAzAt (no refraction). */
export function horizonToEquatorial(
  azDeg: number, altDeg: number, date: Date, lat: number, lon: number,
): [number, number] {
  const observer = new Observer(lat, lon, 0)
  const time = MakeTime(date)
  return equatorialFromHorizontal(altDeg, azDeg, Rotation_HOR_EQJ(time, observer), time)
}

export interface SunInfo { raDeg: number; decDeg: number; alt: number; az: number }

/** Sun position at `date`: equatorial (J2000-ish of-date from astronomy-engine
 *  Equator with aberration) plus local alt/az with refraction. */
export function sunInfo(date: Date, lat: number, lon: number): SunInfo {
  const observer = new Observer(lat, lon, 0)
  const eq = Equator(Body.Sun, date, observer, true, true)
  const hor = Horizon(date, observer, eq.ra, eq.dec, 'normal')
  return { raDeg: eq.ra * 15, decDeg: eq.dec, alt: hor.altitude, az: hor.azimuth }
}

/**
 * Parallactic angle (degrees): the position angle of the zenith as seen from
 * (raDeg, decDeg), measured from north through east. Rolling a chart centred
 * on that point by this angle makes "up" on screen point toward the zenith
 * instead of the celestial pole — the ground-at-the-bottom orientation real
 * telescopes and apps like Stellarium use, instead of a star-atlas chart.
 *
 * Computed wholly in J2000, the frame the sky chart plots in. The textbook
 * hour-angle form works in of-date coordinates instead, and mixing the two
 * costs ~9 degrees of roll for a target a fraction of a degree from the pole,
 * where the ~0.36 degree precession offset swings the position angle wildly.
 */
export function parallacticAngleDeg(raDeg: number, decDeg: number, date: Date, lat: number, lon: number): number {
  const [zenithRa, zenithDec] = zenithEquatorial(date, lat, lon)
  const dRa = (zenithRa - raDeg) * DEG
  const dec = decDeg * DEG, zDec = zenithDec * DEG
  return Math.atan2(
    Math.sin(dRa) * Math.cos(zDec),
    Math.cos(dec) * Math.sin(zDec) - Math.sin(dec) * Math.cos(zDec) * Math.cos(dRa),
  ) / DEG
}
