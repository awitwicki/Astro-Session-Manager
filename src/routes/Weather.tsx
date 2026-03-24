import { useState, useEffect, useRef } from 'react'
import { MapPin, RefreshCw } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Fix Leaflet default marker icon path broken by Vite bundling
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})
import {
  fetchForecast,
  getCloudColor,
  getWindColor,
  getHumidityColor,
  getTempColor,
  getPrecipColor,
  getVisibilityColor,
  getWindArrow,
  type DayForecast,
  type HourData
} from '../lib/weather'
import '../styles/weather.css'

export function Weather() {
  const [lat, setLat] = useState<number | null>(null)
  const [lon, setLon] = useState<number | null>(null)
  const [forecast, setForecast] = useState<DayForecast[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [expandedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const onSelectRef = useRef<(lat: number, lon: number) => void>(() => {})

  // Load saved coordinates and auto-fetch
  useEffect(() => {
    invoke<Record<string, unknown>>('get_all_settings').then(async (settings) => {
      const savedLat = typeof settings.weatherLat === 'number' ? settings.weatherLat : null
      const savedLon = typeof settings.weatherLon === 'number' ? settings.weatherLon : null
      if (savedLat !== null && savedLon !== null) {
        setLat(savedLat)
        setLon(savedLon)
        setLoading(true)
        try {
          const data = await fetchForecast(savedLat, savedLon)
          setForecast(data)
        } catch (err) {
          setError(String(err))
        } finally {
          setLoading(false)
        }
      }
    })
  }, [])

  async function doFetch(la: number, lo: number) {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchForecast(la, lo)
      setForecast(data)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  // Keep onSelectRef fresh so map callbacks always use latest state
  onSelectRef.current = (newLat: number, newLon: number) => {
    setLat(newLat)
    setLon(newLon)
    invoke('set_setting', { key: 'weatherLat', value: newLat }).catch(() => {})
    invoke('set_setting', { key: 'weatherLon', value: newLon }).catch(() => {})
    setShowMap(false)
    doFetch(newLat, newLon)
  }

  // Initialize Leaflet map
  useEffect(() => {
    if (!showMap || !mapRef.current || mapInstanceRef.current) return

    const defaultLat = lat ?? 50
    const defaultLon = lon ?? 20

    const map = L.map(mapRef.current).setView([defaultLat, defaultLon], 6)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(map)

    if (lat !== null && lon !== null) {
      const marker = L.marker([lat, lon], { draggable: true }).addTo(map)
      markerRef.current = marker
      marker.on('dragend', () => {
        const pos = marker.getLatLng()
        onSelectRef.current(Number(pos.lat.toFixed(4)), Number(pos.lng.toFixed(4)))
      })
    }

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (markerRef.current) {
        markerRef.current.setLatLng(e.latlng)
      } else {
        const marker = L.marker(e.latlng, { draggable: true }).addTo(map)
        markerRef.current = marker
        marker.on('dragend', () => {
          const pos = marker.getLatLng()
          onSelectRef.current(Number(pos.lat.toFixed(4)), Number(pos.lng.toFixed(4)))
        })
      }
      onSelectRef.current(Number(e.latlng.lat.toFixed(4)), Number(e.latlng.lng.toFixed(4)))
    })

    mapInstanceRef.current = map
    setTimeout(() => map.invalidateSize(), 100)

    return () => {
      map.remove()
      mapInstanceRef.current = null
      markerRef.current = null
    }
  }, [showMap])

  function toggleCollapse(date: string) {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  return (
    <div className="weather-page">
      <div className="page-header">
        <h1 className="page-title">Astro Weather</h1>
        <div className="weather-coords">
          <button
            className="btn"
            onClick={() => setShowMap(!showMap)}
          >
            <MapPin size={14} />
            {lat !== null ? `${lat}, ${lon}` : 'Set Location'}
          </button>
          {lat !== null && (
            <button
              className="btn btn-primary"
              onClick={() => doFetch(lat, lon!)}
              disabled={loading}
            >
              {loading ? <RefreshCw size={14} className="spinning" /> : <RefreshCw size={14} />}
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* Location map */}
      <div className="weather-location">

        {showMap && (
          <div className="weather-map-container">
            <div ref={mapRef} className="weather-map" />
          </div>
        )}
      </div>

      {error && (
        <div className="weather-error">{error}</div>
      )}

      {/* Forecast grid */}
      {forecast && (
        <div className="weather-days">
          {forecast.map((day) => (
            <DayCard
              key={day.date}
              day={day}
              collapsed={!expandedDays.has(day.date)}
              onToggle={() => toggleCollapse(day.date)}
            />
          ))}
        </div>
      )}

      {!forecast && !loading && !error && (
        <div className="empty-state">
          <h3>No Forecast Loaded</h3>
          <p>Click "Set Location" to pick your coordinates on the map</p>
        </div>
      )}
    </div>
  )
}

interface RowDef {
  label: string
  getValue: (h: HourData) => string
  getColor: (h: HourData) => string
}

const ROWS: RowDef[] = [
  {
    label: 'Total Clouds (%)',
    getValue: (h) => String(Math.round(h.cloudCover)),
    getColor: (h) => getCloudColor(h.cloudCover)
  },
  {
    label: 'Low Clouds (%)',
    getValue: (h) => String(Math.round(h.cloudCoverLow)),
    getColor: (h) => getCloudColor(h.cloudCoverLow)
  },
  {
    label: 'Mid Clouds (%)',
    getValue: (h) => String(Math.round(h.cloudCoverMid)),
    getColor: (h) => getCloudColor(h.cloudCoverMid)
  },
  {
    label: 'High Clouds (%)',
    getValue: (h) => String(Math.round(h.cloudCoverHigh)),
    getColor: (h) => getCloudColor(h.cloudCoverHigh)
  },
  {
    label: 'Temperature (\u00B0C)',
    getValue: (h) => String(Math.round(h.temperature)),
    getColor: (h) => getTempColor(h.temperature)
  },
  {
    label: 'Dew Point (\u00B0C)',
    getValue: (h) => String(Math.round(h.dewPoint)),
    getColor: (h) => getTempColor(h.dewPoint)
  },
  {
    label: 'Humidity (%)',
    getValue: (h) => String(Math.round(h.humidity)),
    getColor: (h) => getHumidityColor(h.humidity)
  },
  {
    label: 'Wind (km/h)',
    getValue: (h) => `${Math.round(h.windSpeed)}${getWindArrow(h.windDirection)}`,
    getColor: (h) => getWindColor(h.windSpeed)
  },
  {
    label: 'Visibility (km)',
    getValue: (h) => String(Math.round(h.visibility / 1000)),
    getColor: (h) => getVisibilityColor(h.visibility)
  },
  {
    label: 'Precip. Prob. (%)',
    getValue: (h) => String(Math.round(h.precipProb)),
    getColor: (h) => getPrecipColor(h.precipProb)
  }
]

// Summary row used in collapsed mode — shows total cloud cover colors
const SUMMARY_ROW = ROWS[0]

function buildSunBarGradient(sunrise: string, sunset: string): string {
  if (sunrise === '--:--' || sunset === '--:--') return '#0d1117'

  const parseTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return (h * 60 + m) / (24 * 60) * 100
  }

  const rise = parseTime(sunrise)
  const set = parseTime(sunset)
  const tw = 4 // twilight transition width %

  const night = '#0d1117'
  const twilight = '#1a3a5c'
  const day = '#e8b830'

  const p = (v: number) => `${v.toFixed(1)}%`

  // sunrise/sunset mark the start of twilight, not the boundary with night
  const riseStart = rise - tw
  const riseEnd = rise + tw
  const setStart = set - tw
  const setEnd = set + tw

  const noon = (rise + set) / 2
  const noonW = 0.3

  return `linear-gradient(to right, ${night} ${p(riseStart)}, ${twilight} ${p(rise)}, ${day} ${p(riseEnd)}, ${day} ${p(noon - noonW)}, ${night} ${p(noon)}, ${day} ${p(noon + noonW)}, ${day} ${p(setStart)}, ${twilight} ${p(set)}, ${night} ${p(setEnd)})`
}

function buildMoonBarGradient(date: string, sunrise: string, illumination: number): string {
  if (sunrise === '--:--') return '#0d1117'

  const parseTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return (h * 60 + m) / (24 * 60) * 100
  }

  // Calculate moon phase ratio (same logic as getMoonPhase)
  const dt = new Date(date + 'T12:00:00')
  const knownNewMoon = new Date('2000-01-06T18:14:00Z')
  const synodicMonth = 29.53059
  const daysSinceNew = (dt.getTime() - knownNewMoon.getTime()) / (1000 * 60 * 60 * 24)
  const phaseRatio = (((daysSinceNew % synodicMonth) + synodicMonth) % synodicMonth) / synodicMonth

  const sunrisePos = parseTime(sunrise)

  // Approximate moonrise: at new moon rises with sun, full moon rises ~12h after
  const moonrise = (sunrisePos + phaseRatio * 100) % 100
  const moonset = (moonrise + 50) % 100 // ~12h above horizon

  const tw = 3
  const night = '#0d1117'
  const b = Math.min(160, Math.round(40 + illumination * 1.2))
  const hex = b.toString(16).padStart(2, '0')
  const moonColor = `#${hex}${hex}${hex}`

  const p = (v: number) => `${Math.max(0, Math.min(100, v)).toFixed(1)}%`

  // Moon's peak altitude is midpoint between moonrise and moonset
  const lw = 0.3

  if (moonrise < moonset) {
    const peak = (moonrise + moonset) / 2
    return `linear-gradient(to right, ${night} ${p(moonrise - tw)}, ${moonColor} ${p(moonrise + tw)}, ${moonColor} ${p(peak - lw)}, ${night} ${p(peak)}, ${moonColor} ${p(peak + lw)}, ${moonColor} ${p(moonset - tw)}, ${night} ${p(moonset + tw)})`
  } else {
    // Wrap: moon visible at start and end of day, peak wraps too
    const peak = ((moonrise + moonset + 100) / 2) % 100
    if (peak > moonrise || peak < moonset) {
      // Peak is in the visible range
      if (peak > moonrise) {
        return `linear-gradient(to right, ${moonColor} ${p(moonset - tw)}, ${night} ${p(moonset + tw)}, ${night} ${p(moonrise - tw)}, ${moonColor} ${p(moonrise + tw)}, ${moonColor} ${p(peak - lw)}, ${night} ${p(peak)}, ${moonColor} ${p(peak + lw)})`
      } else {
        return `linear-gradient(to right, ${moonColor} ${p(peak - lw)}, ${night} ${p(peak)}, ${moonColor} ${p(peak + lw)}, ${moonColor} ${p(moonset - tw)}, ${night} ${p(moonset + tw)}, ${night} ${p(moonrise - tw)}, ${moonColor} ${p(moonrise + tw)})`
      }
    }
    return `linear-gradient(to right, ${moonColor} ${p(moonset - tw)}, ${night} ${p(moonset + tw)}, ${night} ${p(moonrise - tw)}, ${moonColor} ${p(moonrise + tw)})`
  }
}

interface DayCardProps {
  day: DayForecast
  collapsed: boolean
  onToggle: () => void
}

function DayCard({ day, collapsed, onToggle }: DayCardProps) {
  if (day.hours.length === 0) return null

  return (
    <div className="weather-day-card">
      <div className="weather-day-row">
        {/* Left column: info panel + labels when expanded */}
        <div className="weather-day-left">
          <div className="weather-day-info" onClick={onToggle}>
            <div className="weather-day-top">
              <span className="weather-day-number">{day.dayNumber}</span>
              <span className="weather-day-name">{day.dayName}</span>
            </div>

            <div className="weather-moon-info">
              <span className="weather-moon-emoji">{day.moonEmoji}</span>
              <span className="weather-moon-pct">{day.moonIllumination}%</span>
            </div>
            <div className="weather-sun-times">
              <span className="weather-sun-rise">&#9650; {day.sunrise}</span>
              <span className="weather-sun-set">&#9660; {day.sunset}</span>
            </div>
          </div>
          {!collapsed && (
            <div className="weather-labels-col">
              {ROWS.map((row) => (
                <div key={row.label} className="weather-label-cell">{row.label}</div>
              ))}
            </div>
          )}
        </div>

        {/* Right: hourly grid */}
        <div className="weather-day-grid">
            <div className="weather-summary-bar">
              <div className="weather-summary-hours">
                {day.hours.map((h, i) => (
                  <div
                    key={i}
                    className={`weather-summary-cell ${h.isNight ? 'night' : ''}${h.isPast ? ' past' : ''}`}
                    style={{ backgroundColor: SUMMARY_ROW.getColor(h) }}
                  >
                    <span className="weather-summary-hour">{String(h.hour).padStart(2, '0')}</span>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="weather-sun-bar"
              style={{ background: buildSunBarGradient(day.sunrise, day.sunset) }}
            />
            <div
              className="weather-sun-bar"
              style={{ background: buildMoonBarGradient(day.date, day.sunrise, day.moonIllumination) }}
            />
          {!collapsed && (
            <div className="weather-data-rows">
              {ROWS.map((row) => (
                <div key={row.label} className="weather-data-row">
                  {day.hours.map((h, i) => (
                    <div
                      key={i}
                      className={`weather-cell ${h.isNight ? 'night' : ''}${h.isPast ? ' past' : ''}`}
                      style={{ backgroundColor: row.getColor(h) }}
                    >
                      {row.getValue(h)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
