import { buildSearchIndex, type CatalogIndex, type CatalogObject } from './catalogSearch'

let catalogPromise: Promise<CatalogIndex> | null = null

/** Fetches and indexes the bundled catalog once per app run. A failed load
 *  clears the cache so the next call retries. */
export function loadCatalog(): Promise<CatalogIndex> {
  if (!catalogPromise) {
    catalogPromise = fetch('/catalogs/dso.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Catalog load failed: HTTP ${res.status}`)
        return res.json()
      })
      .then((objects: CatalogObject[]) => buildSearchIndex(objects))
      .catch((err) => {
        catalogPromise = null
        throw err
      })
  }
  return catalogPromise
}
