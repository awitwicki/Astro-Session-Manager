// Merges the DSO and star catalogs, the planets and (when downloaded) the
// comets and asteroids into one ranked result list for the Planner search
// box. Either catalog index may be missing (still loading or failed); the
// other sources keep working.

import { scoreCatalog, type CatalogIndex, type CatalogObject } from './catalogSearch'
import { scoreStars, starDesignation, type StarIndex, type StarObject } from './starSearch'
import { PLANET_BODIES } from './movingTargets'
import type { MinorBody } from './mpc'
import type { PlanetBody } from '../types/planner'

export type SearchHit =
  | { kind: 'dso'; obj: CatalogObject }
  | { kind: 'star'; star: StarObject }
  | { kind: 'planet'; body: PlanetBody }
  | { kind: 'minor'; body: MinorBody }

interface Ranked { hit: SearchHit; score: number; mag: number | null; id: string }

/** Lowercase, without spaces and parentheses: "(4) Vesta" → "4vesta". */
const searchKey = (s: string) => s.toLowerCase().replace(/[\s()]+/g, '')

/** Keys a minor body's designation is matched on: the designation itself,
 *  a comet's designation without its "C/" / "P/" prefix, and an asteroid's
 *  bare number. */
function designationKeys(body: MinorBody): string[] {
  const key = searchKey(body.designation)
  const keys = [key]
  const bare = /^[cpdxia]\/(.+)$/.exec(key)
  if (bare) keys.push(bare[1])
  const numbered = /^\((\d+)\)/.exec(body.designation.trim())
  if (numbered) keys.push(numbered[1])
  return keys
}

/** Tiers as in scoreStars: 0 exact designation, 1 designation prefix,
 *  2 name prefix, 3 name substring. */
function scoreMinorBodies(bodies: MinorBody[], query: string, limit: number): { body: MinorBody; score: number }[] {
  const q = query.trim().toLowerCase()
  const qKey = searchKey(q)
  if (!qKey) return []
  const buckets: { body: MinorBody; score: number }[][] = [[], [], [], []]
  for (const body of bodies) {
    let score: number | null = null
    for (const k of designationKeys(body)) {
      if (k === qKey) { score = 0; break }
      if (k.startsWith(qKey)) score = 1
    }
    if (score === null) {
      const name = body.name.toLowerCase()
      const nameKey = searchKey(name)
      if (name.startsWith(q) || nameKey.startsWith(qKey)) score = 2
      else if (name.includes(q) || nameKey.includes(qKey)) score = 3
    }
    if (score !== null && (score === 0 || buckets[score].length < limit)) {
      buckets[score].push({ body, score })
    }
  }
  return buckets.flat()
}

/** Planets match by case-insensitive name prefix, scored like a star's
 *  proper name (2), or 0 when exact. */
function scorePlanets(query: string): { body: PlanetBody; score: number }[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: { body: PlanetBody; score: number }[] = []
  for (const body of PLANET_BODIES) {
    const name = body.toLowerCase()
    if (name === q) out.push({ body, score: 0 })
    else if (name.startsWith(q)) out.push({ body, score: 2 })
  }
  return out
}

export function searchObjects(
  dso: CatalogIndex | null,
  stars: StarIndex | null,
  query: string,
  limit = 20,
  extra?: { minorBodies?: MinorBody[] },
): SearchHit[] {
  const ranked: Ranked[] = []
  if (dso) {
    for (const { o, score } of scoreCatalog(dso, query, limit)) {
      ranked.push({ hit: { kind: 'dso', obj: o }, score, mag: o.mag, id: o.id })
    }
  }
  if (stars) {
    for (const { star, score } of scoreStars(stars, query, limit)) {
      ranked.push({ hit: { kind: 'star', star }, score, mag: star.mag, id: starDesignation(star) })
    }
  }
  // Planets outshine every catalog entry: rank them first within a tier.
  for (const { body, score } of scorePlanets(query)) {
    ranked.push({ hit: { kind: 'planet', body }, score, mag: -Infinity, id: body })
  }
  if (extra?.minorBodies?.length) {
    // Absolute magnitude H stands in for brightness: the search stays
    // independent of the current time.
    for (const { body, score } of scoreMinorBodies(extra.minorBodies, query, limit)) {
      ranked.push({ hit: { kind: 'minor', body }, score, mag: body.elements.H, id: body.designation })
    }
  }
  ranked.sort((a, b) =>
    a.score - b.score
    || (a.mag ?? Infinity) - (b.mag ?? Infinity)
    || a.id.localeCompare(b.id, 'en', { numeric: true }))
  return ranked.slice(0, limit).map((r) => r.hit)
}
