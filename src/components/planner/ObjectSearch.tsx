import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { loadCatalog } from '../../lib/catalog'
import { searchCatalog, type CatalogIndex, type CatalogObject } from '../../lib/catalogSearch'

interface ObjectSearchProps {
  onSelect: (obj: CatalogObject) => void
}

export function ObjectSearch({ onSelect }: ObjectSearchProps) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<CatalogIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = () => {
    setError(null)
    loadCatalog().then(setIndex).catch((err) => setError(String(err)))
  }

  // Close the dropdown on outside clicks
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const results = index && query.trim() ? searchCatalog(index, query) : []

  return (
    <div className="object-search" ref={rootRef}>
      <div className="object-search-input">
        <Search size={14} />
        <input
          type="text"
          placeholder="Add object — M31, NGC 7000, C14, name…"
          value={query}
          onFocus={() => {
            if (!index && !error) load()
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
          {error !== null && (
            <div className="object-search-status">
              Failed to load catalog. <button onClick={load}>Retry</button>
            </div>
          )}
          {error === null && index === null && (
            <div className="object-search-status">Loading catalog…</div>
          )}
          {index !== null && results.length === 0 && (
            <div className="object-search-status">No matches</div>
          )}
          {results.map((obj) => (
            <button
              key={obj.id}
              className="object-search-result"
              onClick={() => {
                onSelect(obj)
                setQuery('')
                setOpen(false)
              }}
            >
              <span className="osr-designation">{obj.id}</span>
              {obj.names.length > 0 && <span className="osr-name">{obj.names[0]}</span>}
              <span className="osr-meta">
                {obj.type}{obj.mag !== null ? ` · mag ${obj.mag.toFixed(1)}` : ''} · {obj.con}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
