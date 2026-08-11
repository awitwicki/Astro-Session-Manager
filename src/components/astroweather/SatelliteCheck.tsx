import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { RefreshCw, ChevronRight, ChevronDown } from 'lucide-react'
import { currentHourClouds, getCloudColor, type DayForecast } from '../../lib/weather'

const WMS_URL = 'https://view.eumetsat.int/geoserver/wms'
const COLLAPSE_KEY = 'astroweather.satellite.collapsed'
const WMS_BUCKET_MS = 15 * 60 * 1000 // matches the layer's own PT15M update cadence

// The EUMETSAT layer updates every 15 min and declares a `time` dimension for
// selecting a specific scan. Omitting `time` (asking for "whatever's current")
// turned out to be unreliable: reproduced repeatedly with curl and confirmed
// via Playwright network capture — the no-time GetMap response can get stuck
// mid-mosaic-update (one half of the frame newer than the other, a hard seam
// down the middle) and then gets served identically, byte-for-byte, for
// multiple requests in a row (same `Last-Modified`), presumably cached
// server-side for the full `Cache-Control: max-age=604800` (7 days) the
// response carries — vs an EXPLICIT `time=` request, which was clean in every
// trial (6/6), including the current 15-minute window requested minutes after
// it opened. Passing the current 15-minute floor as an explicit `time` value
// both avoids that broken default-resolution path and — as a side benefit —
// changes the tile URL every 15 minutes, which also keeps the browser's own
// HTTP cache from mixing tiles from different real-world capture moments
// across zoom levels or revisits. The layer's `nearestValue="1"` dimension
// setting (see GetCapabilities) covers the edge case of asking for a instant
// right at a window boundary before that scan has fully published.
// Mirrors docs/astroweather/js/satellite.js's getWmsTimeBucket (untested here
// — this file follows the project convention of the gh-pages module being
// the tested implementation for shared logic).
function getWmsTimeBucket(now: Date = new Date()): string {
  return new Date(Math.floor(now.getTime() / WMS_BUCKET_MS) * WMS_BUCKET_MS).toISOString()
}

const MARKER_STYLE: L.CircleMarkerOptions = {
  radius: 6,
  color: '#ffffff',
  weight: 2,
  fillColor: '#f44336',
  fillOpacity: 1,
}

interface SatelliteCheckProps {
  lat: number | null
  lon: number | null
  forecast: DayForecast[] | null
  // The forecast-wide "Refresh" control lives here (in the header row) rather
  // than as its own bar above the card, so it lines up with the card's own
  // header instead of floating as a taller, misaligned row on top of it.
  onForecastRefresh: () => void
  forecastRefreshing: boolean
}

export function SatelliteCheck({ lat, lon, forecast, onForecastRefresh, forecastRefreshing }: SatelliteCheckProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [tileError, setTileError] = useState(false)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const wmsRef = useRef<L.TileLayer.WMS | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)
  // Lat/lon the map view is currently centered on — lets us tell "the
  // location changed" apart from "this effect re-ran for some other reason
  // (e.g. collapsed toggled)" so we don't stomp on the user's own pan/zoom.
  const centeredRef = useRef<{ lat: number; lon: number } | null>(null)
  // Last 15-min cache-bust window applied to the WMS layer's tile URLs.
  const lastBucketRef = useRef<string | null>(null)

  // Create the map the first time the card is expanded; sync the marker.
  // The map container (`sat-body`) stays mounted in the DOM at all times —
  // collapsing only toggles a CSS `hidden` class (see JSX below) — so the
  // Leaflet instance and its bound container never get orphaned across a
  // collapse/expand cycle the way they would if the container were
  // conditionally unmounted.
  useEffect(() => {
    if (collapsed || !mapRef.current) return
    if (!mapInstanceRef.current) {
      const map = L.map(mapRef.current).setView(
        lat !== null && lon !== null ? [lat, lon] : [49, 20],
        7,
      )
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(map)
      const bucket = getWmsTimeBucket()
      const wms = L.tileLayer.wms(WMS_URL, {
        layers: 'msg_fes:ir108',
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        opacity: 0.75,
        attribution: 'Satellite: &copy; EUMETSAT',
        time: bucket,
      } as L.WMSOptions).addTo(map)
      wms.on('tileerror', () => setTileError(true))
      mapInstanceRef.current = map
      wmsRef.current = wms
      lastBucketRef.current = bucket
      if (lat !== null && lon !== null) centeredRef.current = { lat, lon }
      setTimeout(() => map.invalidateSize(), 100)
    } else {
      // The container was `display:none` while collapsed — Leaflet cached
      // pixel size at creation time and needs an explicit nudge to redraw
      // correctly now that the container is visible again.
      mapInstanceRef.current.invalidateSize()
    }

    const map = mapInstanceRef.current
    if (lat !== null && lon !== null) {
      // Re-center only when the location actually changed — this effect
      // also re-runs on a bare `collapsed` toggle, and recentering then
      // would discard any panning/zooming the user did in the meantime.
      const centered = centeredRef.current
      if (!centered || centered.lat !== lat || centered.lon !== lon) {
        map.setView([lat, lon], map.getZoom())
        centeredRef.current = { lat, lon }
      }
      if (markerRef.current) markerRef.current.setLatLng([lat, lon])
      else markerRef.current = L.circleMarker([lat, lon], MARKER_STYLE).addTo(map)
    }
  }, [collapsed, lat, lon])

  // Piggyback on the app's existing data-refresh cycle (mount, manual
  // refresh, location change — `forecast` gets a new reference each time)
  // to keep an already-created map's tiles from going stale, without adding
  // a new timer. See getWmsTimeBucket above for why this exists.
  useEffect(() => {
    if (!wmsRef.current) return
    const bucket = getWmsTimeBucket()
    if (bucket !== lastBucketRef.current) {
      lastBucketRef.current = bucket
      wmsRef.current.setParams({ time: bucket } as unknown as L.WMSParams)
    }
  }, [forecast])

  // Destroy the map on unmount (tab switch).
  useEffect(() => {
    return () => {
      mapInstanceRef.current?.remove()
      mapInstanceRef.current = null
      wmsRef.current = null
      markerRef.current = null
    }
  }, [])

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      return !c
    })
  }

  function refreshImage() {
    setTileError(false)
    // Extra param cache-busts the WMS tiles so the latest frame is fetched.
    wmsRef.current?.setParams({ ts: Date.now() } as unknown as L.WMSParams)
  }

  const now = currentHourClouds(forecast)

  return (
    <div className="sat-card">
      <div className="sat-header" onClick={toggle}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span className="sat-title">Satellite check</span>
        <span className="sat-caption">EUMETSAT Meteosat IR 10.8 µm — latest frame</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={(e) => { e.stopPropagation(); onForecastRefresh() }}
          disabled={forecastRefreshing}
        >
          <RefreshCw size={14} className={forecastRefreshing ? 'spinning' : ''} />
          {forecastRefreshing ? 'Loading...' : 'Refresh weather'}
        </button>
      </div>
      <div className={`sat-body${collapsed ? ' hidden' : ''}`}>
        <div className="sat-map">
          <div ref={mapRef} className="sat-map-inner" />
          {tileError && <div className="sat-error">Satellite unavailable</div>}
        </div>
        <div className="sat-now">
          <div className="sat-now-title">{now ? `NOW ${String(now.hour).padStart(2, '0')}:00` : 'NOW'}</div>
          {now ? (
            <>
              {now.models.map((m) => (
                <div key={m.id} className="sat-now-row">
                  <span className="sat-now-label">{m.label}</span>
                  <span
                    className="sat-chip"
                    style={m.total !== null ? { backgroundColor: getCloudColor(m.total) } : undefined}
                  >
                    {m.total === null ? '—' : `${Math.round(m.total)}%`}
                  </span>
                  <span className="sat-weight">×{m.weight.toFixed(2)}</span>
                </div>
              ))}
              <div className="sat-now-row blend">
                <span className="sat-now-label">Blend</span>
                <span
                  className="sat-chip"
                  style={now.blend !== null ? { backgroundColor: getCloudColor(now.blend) } : undefined}
                >
                  {now.blend === null ? '—' : `${Math.round(now.blend)}%`}
                </span>
                <span className="sat-weight" />
              </div>
            </>
          ) : (
            <div className="sat-now-empty">No forecast for the current hour</div>
          )}
          <button className="btn btn-primary sat-refresh" onClick={refreshImage}>
            <RefreshCw size={14} /> Refresh image
          </button>
        </div>
      </div>
    </div>
  )
}
