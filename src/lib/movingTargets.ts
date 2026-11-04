// Positions of targets that move against the stars. Fixed targets (no
// `mover`) just return their stored J2000 coordinates.
import { Body, EquatorFromVector, GeoVector, Illumination } from 'astronomy-engine'
import { asteroidMagnitude, cometMagnitude, geocentricEquatorial, type OrbitalElements } from './orbits'
import type { MinorBody } from './mpc'
import type { PlanetBody, PlannerTarget } from '../types/planner'

export const PLANET_BODIES: PlanetBody[] = [
  'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Moon',
]

/** Geocentric J2000 position (aberration included) and apparent magnitude.
 *  Topocentric parallax is ignored — negligible for planets, up to ~1 degree
 *  for the Moon. */
export function planetPosition(
  body: PlanetBody, date: Date,
): { ra: number; dec: number; mag: number | null } {
  const eq = EquatorFromVector(GeoVector(Body[body], date, true))
  return { ra: eq.ra * 15, dec: eq.dec, mag: Illumination(Body[body], date).mag }
}

export function targetPosition(t: PlannerTarget, date: Date): { ra: number; dec: number } {
  const m = t.mover
  if (!m) return { ra: t.ra, dec: t.dec }
  if (m.kind === 'planet') {
    const { ra, dec } = planetPosition(m.body, date)
    return { ra, dec }
  }
  const { ra, dec } = geocentricEquatorial(m.elements, date)
  return { ra, dec }
}

/** Apparent magnitude at `date`. Fixed targets return their stored value;
 *  movers are recomputed. Non-finite results (asteroid phase law at extreme
 *  phase angles) come back as null. */
export function targetMagnitude(t: PlannerTarget, date: Date): number | null {
  const m = t.mover
  if (!m) return t.mag
  const mag = m.kind === 'planet'
    ? planetPosition(m.body, date).mag
    : minorBodyAt(m.kind, m.elements, date).mag
  return mag !== null && Number.isFinite(mag) ? mag : null
}

function minorBodyAt(kind: MinorBody['kind'], el: OrbitalElements, date: Date) {
  const p = geocentricEquatorial(el, date)
  const mag = kind === 'comet'
    ? cometMagnitude(el.H, el.G, p.rAu, p.deltaAu)
    : asteroidMagnitude(el.H, el.G, p.rAu, p.deltaAu, p.phaseDeg)
  return { ra: p.ra, dec: p.dec, mag }
}

export interface BrightMinorBody { body: MinorBody; ra: number; dec: number; mag: number }

/** The bodies at or brighter than `magLimit` at `date`, with their positions. */
export function brightMinorBodies(bodies: MinorBody[], date: Date, magLimit: number): BrightMinorBody[] {
  const out: BrightMinorBody[] = []
  for (const body of bodies) {
    const { ra, dec, mag } = minorBodyAt(body.kind, body.elements, date)
    if (Number.isFinite(mag) && mag <= magLimit) out.push({ body, ra, dec, mag })
  }
  return out
}
