import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Lorenz World Atlas raster overlay — one tile set per published year (2024 = latest).
const YEARS = [2024, 2023, 2022] as const
const tileUrl = (year: number) =>
  `https://djlorenz.github.io/astronomy/image_tiles/tiles${year}/tile_{z}_{x}_{y}.png`

// 1x1 transparent PNG — used for missing/ocean tiles so there are no broken-image squares.
const TRANSPARENT_TILE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// CircleMarker style for the saved location.
const MARKER_STYLE: L.CircleMarkerOptions = {
  radius: 6,
  color: '#ffffff',
  weight: 2,
  fillColor: '#f44336',
  fillOpacity: 1,
}

// Approximate Bortle color key for the overlay's brightness scale (darkest → brightest).
const LEGEND = [
  { color: '#000000', label: '1' },
  { color: '#2b2b50', label: '2' },
  { color: '#1f4fa8', label: '3' },
  { color: '#2e8b57', label: '4' },
  { color: '#d4c12a', label: '5' },
  { color: '#e08a1e', label: '6' },
  { color: '#c4302b', label: '7' },
  { color: '#dcdcdc', label: '8' },
  { color: '#ffffff', label: '9' },
]

interface LightPollutionMapProps {
  lat: number | null
  lon: number | null
}

export function LightPollutionMap({ lat, lon }: LightPollutionMapProps) {
  const [year, setYear] = useState<number>(YEARS[0])
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const overlayRef = useRef<L.TileLayer | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)

  // Create the map once (OSM base); keep its view + marker in sync with the location.
  useEffect(() => {
    if (!mapRef.current) return

    const justCreated = !mapInstanceRef.current
    if (justCreated) {
      const map = L.map(mapRef.current, { worldCopyJump: true }).setView(
        lat !== null && lon !== null ? [lat, lon] : [30, 0],
        lat !== null && lon !== null ? 8 : 3,
      )
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(map)
      mapInstanceRef.current = map
      setTimeout(() => map.invalidateSize(), 100)
    }

    const map = mapInstanceRef.current
    if (!map) return

    if (lat !== null && lon !== null) {
      // The create branch already set the initial view; only recenter on later changes.
      if (!justCreated) map.setView([lat, lon], 8)
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lon])
      } else {
        markerRef.current = L.circleMarker([lat, lon], MARKER_STYLE).addTo(map)
      }
    } else if (markerRef.current) {
      markerRef.current.remove()
      markerRef.current = null
    }
  }, [lat, lon])

  // Add the Lorenz overlay (runs after the map is created) and swap its tiles on year change.
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    if (overlayRef.current) {
      overlayRef.current.setUrl(tileUrl(year))
    } else {
      overlayRef.current = L.tileLayer(tileUrl(year), {
        maxNativeZoom: 6,
        maxZoom: 11,
        opacity: 0.6,
        errorTileUrl: TRANSPARENT_TILE,
        attribution: 'Light pollution: &copy; David J. Lorenz / Falchi et al.',
      }).addTo(map)
    }
  }, [year])

  // Destroy the map on unmount (tab switch).
  useEffect(() => {
    return () => {
      mapInstanceRef.current?.remove()
      mapInstanceRef.current = null
      overlayRef.current = null
      markerRef.current = null
    }
  }, [])

  return (
    <div className="lp-root">
      <div className="lp-map-container">
        <div ref={mapRef} className="lp-map" />
        <div className="lp-year">
          <span className="lp-year-label">Atlas</span>
          {YEARS.map((y) => (
            <button
              key={y}
              className={`lp-year-btn ${y === year ? 'active' : ''}`}
              onClick={() => setYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
        <div className="lp-legend">
          <span className="lp-legend-label">Darker</span>
          {LEGEND.map((b) => (
            <span key={b.label} className="lp-legend-item">
              <i className="lp-swatch" style={{ background: b.color }} />
              {b.label}
            </span>
          ))}
          <span className="lp-legend-label">Brighter — Bortle</span>
        </div>
      </div>
      {(lat === null || lon === null) && (
        <p className="lp-hint">Use "Set Location" (top bar) to center the map on your site.</p>
      )}
    </div>
  )
}
