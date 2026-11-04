// The one place that turns a search hit or typed coordinates into a saved
// PlannerTarget.

import type { CatalogObject } from './catalogSearch'
import { starDesignation, starDisplayName, type StarObject } from './starSearch'
import { formatDec, formatRA } from './formatters'
import { planetPosition } from './movingTargets'
import type { MinorBody } from './mpc'
import { asteroidMagnitude, cometMagnitude, geocentricEquatorial } from './orbits'
import type { SearchHit } from './objectSearch'
import type { PlanetBody, PlannerTarget } from '../types/planner'

export function targetFromDso(obj: CatalogObject, now = new Date()): PlannerTarget {
  return {
    id: obj.id,
    name: obj.names[0] ?? obj.id,
    designation: obj.id,
    messier: obj.m,
    ra: obj.ra,
    dec: obj.dec,
    type: obj.type,
    mag: obj.mag,
    sizeArcmin: obj.size,
    constellation: obj.con,
    addedAt: now.toISOString(),
  }
}

export function targetFromStar(star: StarObject, now = new Date()): PlannerTarget {
  const designation = starDesignation(star)
  return {
    id: designation,
    name: starDisplayName(star),
    designation,
    messier: null,
    ra: star.ra,
    dec: star.dec,
    type: 'Star',
    mag: star.mag,
    sizeArcmin: null,
    constellation: star.con,
    addedAt: now.toISOString(),
  }
}

/** A user-entered position. The id is unique per creation instant; the
 *  formatted coordinates serve as designation and as the name fallback. */
export function targetFromCoords(name: string, ra: number, dec: number, now = new Date()): PlannerTarget {
  const designation = `${formatRA(ra)} ${formatDec(dec)}`
  const trimmed = name.trim()
  return {
    id: `custom-${now.getTime()}`,
    name: trimmed || designation,
    designation,
    messier: null,
    ra,
    dec,
    type: 'Custom',
    mag: null,
    sizeArcmin: null,
    constellation: '',
    addedAt: now.toISOString(),
  }
}

/** A planet or the Moon. ra/dec is a snapshot at `now`; live positions come
 *  from targetPosition via `mover`. */
export function targetFromPlanet(body: PlanetBody, now = new Date()): PlannerTarget {
  const { ra, dec, mag } = planetPosition(body, now)
  return {
    id: `planet-${body}`,
    name: body,
    designation: body,
    messier: null,
    ra,
    dec,
    type: body === 'Moon' ? 'Moon' : 'Planet',
    mag,
    sizeArcmin: null,
    constellation: '',
    addedAt: now.toISOString(),
    mover: { kind: 'planet', body },
  }
}

/** A comet or asteroid. ra/dec and mag are estimates at `now`; live
 *  positions come from targetPosition via `mover`. A magnitude that is not
 *  finite (asteroid phase law at extreme phase angles) is stored as null. */
export function targetFromMinorBody(body: MinorBody, now = new Date()): PlannerTarget {
  const el = body.elements
  const p = geocentricEquatorial(el, now)
  const mag = body.kind === 'comet'
    ? cometMagnitude(el.H, el.G, p.rAu, p.deltaAu)
    : asteroidMagnitude(el.H, el.G, p.rAu, p.deltaAu, p.phaseDeg)
  return {
    id: body.designation,
    name: body.name || body.designation,
    designation: body.designation,
    messier: null,
    ra: p.ra,
    dec: p.dec,
    type: body.kind === 'comet' ? 'Comet' : 'Asteroid',
    mag: Number.isFinite(mag) ? mag : null,
    sizeArcmin: null,
    constellation: '',
    addedAt: now.toISOString(),
    mover: { kind: body.kind, elements: el },
  }
}

export function targetFromHit(hit: SearchHit, now = new Date()): PlannerTarget {
  switch (hit.kind) {
    case 'dso': return targetFromDso(hit.obj, now)
    case 'star': return targetFromStar(hit.star, now)
    case 'planet': return targetFromPlanet(hit.body, now)
    case 'minor': return targetFromMinorBody(hit.body, now)
  }
}

/** Swaps in freshly downloaded orbital elements for comet / asteroid targets
 *  (matched on designation and kind). Returns the same array when nothing
 *  matched; unmatched targets keep their stored copy. */
export function refreshMinorTargets(targets: PlannerTarget[], bodies: MinorBody[]): PlannerTarget[] {
  if (bodies.length === 0) return targets
  const byKey = new Map(bodies.map((b) => [`${b.kind}|${b.designation}`, b]))
  let changed = false
  const next = targets.map((t) => {
    const kind = t.mover?.kind
    if (kind !== 'comet' && kind !== 'asteroid') return t
    const body = byKey.get(`${kind}|${t.designation}`)
    if (!body) return t
    changed = true
    return { ...t, mover: { kind: body.kind, elements: body.elements } }
  })
  return changed ? next : targets
}
