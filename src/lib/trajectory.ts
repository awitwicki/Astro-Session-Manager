import { altAzCurve, horizonToEquatorial, type AltAzPoint } from './ephemeris'

export interface TrajectoryPoint { ra: number; dec: number; time: Date; alt: number; az: number }

/** The target's alt-az path across the 24h window starting at `nightStart`,
 *  re-expressed as J2000 RA/Dec for the sky as it stands at `frameTime` —
 *  i.e. the arc the target traces relative to the GROUND, drawable on a
 *  chart whose orientation belongs to `frameTime`. */
export function trajectoryPathJ2000(
  raDeg: number, decDeg: number, nightStart: Date, frameTime: Date,
  lat: number, lon: number, stepMinutes = 10,
): TrajectoryPoint[] {
  return altAzCurve(raDeg, decDeg, nightStart, lat, lon, stepMinutes).map((p: AltAzPoint) => {
    const [ra, dec] = horizonToEquatorial(p.az, p.alt, frameTime, lat, lon)
    return { ra, dec, time: p.time, alt: p.alt, az: p.az }
  })
}
