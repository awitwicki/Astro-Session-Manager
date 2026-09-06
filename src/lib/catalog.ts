import { buildSearchIndex, type CatalogIndex, type CatalogObject } from './catalogSearch'
import { buildStarIndex, decodeStarRows, type StarIndex, type StarRow } from './starSearch'

/** Fetches and indexes a bundled catalog once per app run. A failed load
 *  clears the cache so the next call retries. */
function catalogLoader<T>(url: string, build: (json: unknown) => T): () => Promise<T> {
  let promise: Promise<T> | null = null
  return () => {
    if (!promise) {
      promise = fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`Catalog load failed: HTTP ${res.status}`)
          return res.json()
        })
        .then(build)
        .catch((err) => {
          promise = null
          throw err
        })
    }
    return promise
  }
}

export const loadCatalog: () => Promise<CatalogIndex> = catalogLoader(
  '/catalogs/dso.json',
  (objects) => buildSearchIndex(objects as CatalogObject[]),
)

export const loadStarCatalog: () => Promise<StarIndex> = catalogLoader(
  '/catalogs/stars.json',
  (rows) => buildStarIndex(decodeStarRows(rows as StarRow[])),
)
