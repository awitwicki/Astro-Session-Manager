import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { loadCatalog, loadStarCatalog } from '../../lib/catalog'
import { searchObjects, type SearchHit } from '../../lib/objectSearch'
import { starDesignation, starDisplayName, type StarObject } from '../../lib/starSearch'

interface ObjectSearchProps {
  onSelect: (hit: SearchHit) => void
}

/** One lazily loaded catalog with its own error state, so a failure in one
 *  catalog never hides the other's results. */
function useCatalog<T>(load: () => Promise<T>) {
  const [index, setIndex] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const start = () => {
    setError(null)
    load().then(setIndex).catch((err) => setError(String(err)))
  }
  return { index, error, start }
}

function starMeta(star: StarObject): string {
  const ids = star.hd !== null && star.hip !== null ? ` · HIP ${star.hip}` : ''
  return `Star · mag ${star.mag.toFixed(1)} · ${star.con}${ids}`
}

export function ObjectSearch({ onSelect }: ObjectSearchProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const dso = useCatalog(loadCatalog)
  const stars = useCatalog(loadStarCatalog)
  const rootRef = useRef<HTMLDivElement>(null)

  const loadAll = () => {
    if (!dso.index && !dso.error) dso.start()
    if (!stars.index && !stars.error) stars.start()
  }

  // Close the dropdown on outside clicks
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const anyLoaded = dso.index !== null || stars.index !== null
  const results = query.trim() ? searchObjects(dso.index, stars.index, query) : []

  const pick = (hit: SearchHit) => {
    onSelect(hit)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="object-search" ref={rootRef}>
      <div className="object-search-input">
        <Search size={14} />
        <input
          type="text"
          placeholder="Add object — M31, NGC 7000, HD 172167, Vega…"
          value={query}
          onFocus={() => {
            loadAll()
            setOpen(true)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
        />
      </div>
      {open && query.trim() !== '' && (
        <div className="object-search-dropdown">
          {dso.error !== null && (
            <div className="object-search-status">
              Failed to load the deep-sky catalog. <button onClick={dso.start}>Retry</button>
            </div>
          )}
          {stars.error !== null && (
            <div className="object-search-status">
              Failed to load the star catalog. <button onClick={stars.start}>Retry</button>
            </div>
          )}
          {!anyLoaded && dso.error === null && stars.error === null && (
            <div className="object-search-status">Loading catalogs…</div>
          )}
          {anyLoaded && results.length === 0 && (
            <div className="object-search-status">No matches</div>
          )}
          {results.map((hit) => {
            if (hit.kind === 'dso') {
              const obj = hit.obj
              return (
                <button key={`dso:${obj.id}`} className="object-search-result" onClick={() => pick(hit)}>
                  <span className="osr-designation">{obj.id}</span>
                  {obj.names.length > 0 && <span className="osr-name">{obj.names[0]}</span>}
                  <span className="osr-meta">
                    {obj.type}{obj.mag !== null ? ` · mag ${obj.mag.toFixed(1)}` : ''} · {obj.con}
                  </span>
                </button>
              )
            }
            const designation = starDesignation(hit.star)
            const name = starDisplayName(hit.star)
            return (
              <button key={`star:${designation}`} className="object-search-result" onClick={() => pick(hit)}>
                <span className="osr-designation">{designation}</span>
                {name !== designation && <span className="osr-name">{name}</span>}
                <span className="osr-meta">{starMeta(hit.star)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
