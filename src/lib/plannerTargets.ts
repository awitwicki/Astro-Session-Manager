// The one place that turns a search hit or typed coordinates into a saved
// PlannerTarget.

import type { CatalogObject } from './catalogSearch'
import { starDesignation, starDisplayName, type StarObject } from './starSearch'
import { formatDec, formatRA } from './formatters'
import type { PlannerTarget } from '../types/planner'

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
