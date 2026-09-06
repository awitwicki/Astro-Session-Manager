// Merges the DSO and star catalogs into one ranked result list for the
// Planner search box. Either index may be missing (still loading or failed);
// the other keeps working.

import { scoreCatalog, type CatalogIndex, type CatalogObject } from './catalogSearch'
import { scoreStars, starDesignation, type StarIndex, type StarObject } from './starSearch'

export type SearchHit =
  | { kind: 'dso'; obj: CatalogObject }
  | { kind: 'star'; star: StarObject }

interface Ranked { hit: SearchHit; score: number; mag: number | null; id: string }

export function searchObjects(
  dso: CatalogIndex | null,
  stars: StarIndex | null,
  query: string,
  limit = 20,
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
  ranked.sort((a, b) =>
    a.score - b.score
    || (a.mag ?? Infinity) - (b.mag ?? Infinity)
    || a.id.localeCompare(b.id, 'en', { numeric: true }))
  return ranked.slice(0, limit).map((r) => r.hit)
}
