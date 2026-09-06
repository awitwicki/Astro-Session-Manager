// Pure in-memory search over the bundled DSO catalog. No I/O here —
// loading lives in catalog.ts so this file is unit-testable.

export interface CatalogObject {
  id: string // designation, e.g. "NGC 7000"
  m: number | null // Messier number
  c: number | null // Caldwell number
  names: string[] // common names
  type: string
  ra: number // J2000 degrees
  dec: number
  mag: number | null
  size: [number, number] | null // arcmin, major x minor
  con: string // constellation abbreviation
}

/** `objects` are ordered brightest-first (unknown magnitude last, ties by
 *  designation), so a scan in index order yields each score bucket already in
 *  display order. */
export interface CatalogIndex {
  objects: CatalogObject[]
  byDesignation: Map<string, CatalogObject>
}

// "NGC 7000" -> "ngc7000", "M 31" -> "m31"
function designationKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

/** "NGC 7000" → ["NGC", 7000, ""]: compares catalog prefix, then number, then
 *  any suffix, without the cost of a locale-aware string compare. */
function designationParts(id: string): [string, number, string] {
  const m = /^(\D*?)\s*(\d+)(.*)$/.exec(id)
  return m ? [m[1], Number(m[2]), m[3]] : [id, Infinity, '']
}

const byBrightness = (a: CatalogObject, b: CatalogObject) => {
  const mag = (a.mag ?? Infinity) - (b.mag ?? Infinity)
  if (mag) return mag
  const [pa, na, sa] = designationParts(a.id)
  const [pb, nb, sb] = designationParts(b.id)
  return pa < pb ? -1 : pa > pb ? 1 : na - nb || (sa < sb ? -1 : sa > sb ? 1 : 0)
}

export function buildSearchIndex(input: CatalogObject[]): CatalogIndex {
  const objects = [...input].sort(byBrightness)
  const byDesignation = new Map<string, CatalogObject>()
  for (const o of objects) {
    byDesignation.set(designationKey(o.id), o)
    if (o.m !== null && !byDesignation.has(`m${o.m}`)) byDesignation.set(`m${o.m}`, o)
    if (o.c !== null && !byDesignation.has(`c${o.c}`)) byDesignation.set(`c${o.c}`, o)
  }
  return { objects, byDesignation }
}

export interface ScoredObject { o: CatalogObject; score: number }

/** Matching objects, best first: score 0 exact designation, 1 designation
 *  prefix, 2 common-name prefix, 3 common-name substring; brighter first within
 *  a score. Each prefix/name bucket keeps only its `limit` brightest objects —
 *  enough to fill any merged list of `limit` results without sorting
 *  thousands of hits per keystroke. */
export function scoreCatalog(index: CatalogIndex, query: string, limit = 20): ScoredObject[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const qKey = designationKey(q)
  const exact = index.byDesignation.get(qKey) ?? null
  const buckets: ScoredObject[][] = [exact ? [{ o: exact, score: 0 }] : [], [], [], []]

  for (const o of index.objects) {
    if (o === exact) continue
    let score: number | null = null
    if (designationKey(o.id).startsWith(qKey)) score = 1
    else if (o.names.some((n) => n.toLowerCase().startsWith(q))) score = 2
    else if (o.names.some((n) => n.toLowerCase().includes(q))) score = 3
    if (score !== null && buckets[score].length < limit) buckets[score].push({ o, score })
  }
  return buckets.flat()
}

export function searchCatalog(index: CatalogIndex, query: string, limit = 20): CatalogObject[] {
  return scoreCatalog(index, query, limit).slice(0, limit).map((r) => r.o)
}
