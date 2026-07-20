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

export interface CatalogIndex {
  objects: CatalogObject[]
  byDesignation: Map<string, CatalogObject>
}

// "NGC 7000" -> "ngc7000", "M 31" -> "m31"
function designationKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

export function buildSearchIndex(objects: CatalogObject[]): CatalogIndex {
  const byDesignation = new Map<string, CatalogObject>()
  for (const o of objects) {
    byDesignation.set(designationKey(o.id), o)
    if (o.m !== null && !byDesignation.has(`m${o.m}`)) byDesignation.set(`m${o.m}`, o)
    if (o.c !== null && !byDesignation.has(`c${o.c}`)) byDesignation.set(`c${o.c}`, o)
  }
  return { objects, byDesignation }
}

export function searchCatalog(index: CatalogIndex, query: string, limit = 20): CatalogObject[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const qKey = designationKey(q)
  const results: { o: CatalogObject; score: number }[] = []
  const seen = new Set<CatalogObject>()

  const exact = index.byDesignation.get(qKey)
  if (exact) {
    results.push({ o: exact, score: 0 })
    seen.add(exact)
  }

  for (const o of index.objects) {
    if (seen.has(o)) continue
    let score: number | null = null
    if (designationKey(o.id).startsWith(qKey)) score = 1
    else if (o.names.some((n) => n.toLowerCase().startsWith(q))) score = 2
    else if (o.names.some((n) => n.toLowerCase().includes(q))) score = 3
    if (score !== null) {
      results.push({ o, score })
      seen.add(o)
    }
  }

  results.sort((a, b) =>
    a.score - b.score
    || (a.o.mag ?? Infinity) - (b.o.mag ?? Infinity)
    || a.o.id.localeCompare(b.o.id, 'en', { numeric: true }))
  return results.slice(0, limit).map((r) => r.o)
}
