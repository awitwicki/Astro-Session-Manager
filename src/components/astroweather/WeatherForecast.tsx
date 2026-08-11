import { useState, useEffect, useRef } from 'react'
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
  type HourData,
} from '../../lib/weather'
import { altitudeCrossing, dayOfYear } from '../../lib/sun'
import { SatelliteCheck } from './SatelliteCheck'

interface WeatherForecastProps {
  lat: number | null
  lon: number | null
}

export function WeatherForecast({ lat, lon }: WeatherForecastProps) {
  const [forecast, setForecast] = useState<DayForecast[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const [refreshKey, setRefreshKey] = useState(0)
  const [popover, setPopover] = useState<PopoverState | null>(null)

  useEffect(() => {
    if (lat === null || lon === null) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    // A new fetch invalidates any open popover: it references stale HourData
    // objects and a cell position that may no longer exist once new data lands.
    setPopover(null)
    fetchForecast(lat, lon)
      .then((data) => { if (!cancelled) setForecast(data) })
      .catch((err) => { if (!cancelled) setError(String(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [lat, lon, refreshKey])

  function toggleCollapse(date: string) {
    setCollapsedDays((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function openPopover(e: React.MouseEvent<HTMLDivElement>, h: HourData, type: CloudKey, pinned: boolean) {
    // Hover must never hijack a pinned popover onto a different cell; only a
    // click (pinned === true) may open/redirect while something is pinned.
    if (!pinned && popover?.pinned) return
    const r = e.currentTarget.getBoundingClientRect()
    setPopover({ x: r.left + r.width / 2, y: r.bottom, type, hour: h, pinned })
  }
  const closePopover = () => setPopover(null)
  const onCloudLeave = () => setPopover((p) => (p && p.pinned ? p : null))

  return (
    <>
      {error && <div className="weather-error">{error}</div>}

      {lat !== null && lon !== null && (
        <SatelliteCheck
          lat={lat}
          lon={lon}
          forecast={forecast}
          onForecastRefresh={() => setRefreshKey((k) => k + 1)}
          forecastRefreshing={loading}
        />
      )}

      {forecast && (
        <div className="weather-days">
          {forecast.map((day) => (
            <DayCard
              key={day.date}
              day={day}
              lat={lat}
              collapsed={!expandedDays.has(day.date)}
              onToggle={() => toggleCollapse(day.date)}
              onCloudCell={openPopover}
              onCloudLeave={onCloudLeave}
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

      {popover && <CloudPopover pop={popover} onClose={closePopover} />}
    </>
  )
}

type CloudKey = 'total' | 'low' | 'mid' | 'high'

// Typed to admit `number | null` even though `HourData`'s cloud fields are
// (inaccurately) typed as plain `number`: `blendOf()` in weather.ts casts a
// genuinely nullable `blendValues()` result to `number`, so at runtime these
// getters can hand back `null` when every model is null for that hour. The
// cast stays local to this file — see Finding 1 in the final review.
const BLEND_FIELD: Record<CloudKey, (h: HourData) => number | null> = {
  total: (h) => h.cloudCover,
  low: (h) => h.cloudCoverLow,
  mid: (h) => h.cloudCoverMid,
  high: (h) => h.cloudCoverHigh,
}

interface PopoverState {
  x: number        // viewport px, cell center
  y: number        // viewport px, cell bottom
  type: CloudKey
  hour: HourData
  pinned: boolean  // pinned = opened by click (touch); survives mouseout
}

interface RowDef {
  label: string
  getValue: (h: HourData) => string
  getColor: (h: HourData) => string
  cloudType?: CloudKey
}

const ROWS: RowDef[] = [
  { label: 'Total Clouds (%)', getValue: (h) => String(Math.round(h.cloudCover)), getColor: (h) => getCloudColor(h.cloudCover), cloudType: 'total' },
  { label: 'Low Clouds (%)', getValue: (h) => String(Math.round(h.cloudCoverLow)), getColor: (h) => getCloudColor(h.cloudCoverLow), cloudType: 'low' },
  { label: 'Mid Clouds (%)', getValue: (h) => String(Math.round(h.cloudCoverMid)), getColor: (h) => getCloudColor(h.cloudCoverMid), cloudType: 'mid' },
  { label: 'High Clouds (%)', getValue: (h) => String(Math.round(h.cloudCoverHigh)), getColor: (h) => getCloudColor(h.cloudCoverHigh), cloudType: 'high' },
  { label: 'Temperature (°C)', getValue: (h) => String(Math.round(h.temperature)), getColor: (h) => getTempColor(h.temperature) },
  { label: 'Dew Point (°C)', getValue: (h) => String(Math.round(h.dewPoint)), getColor: (h) => getTempColor(h.dewPoint) },
  { label: 'Humidity (%)', getValue: (h) => String(Math.round(h.humidity)), getColor: (h) => getHumidityColor(h.humidity) },
  { label: 'Wind (km/h)', getValue: (h) => `${Math.round(h.windSpeed)}${getWindArrow(h.windDirection)}`, getColor: (h) => getWindColor(h.windSpeed) },
  { label: 'Visibility (km)', getValue: (h) => String(Math.round(h.visibility / 1000)), getColor: (h) => getVisibilityColor(h.visibility) },
  { label: 'Precip. Prob. (%)', getValue: (h) => String(Math.round(h.precipProb)), getColor: (h) => getPrecipColor(h.precipProb) },
]

const SUMMARY_ROW = ROWS[0]

// High-contrast day → twilight → night palette (distinct lightness steps).
const TW_DAY = '#e8b830'
const TW_CIVIL = '#6f9ad0'
const TW_NAUTICAL = '#3f6196'
const TW_ASTRO = '#22324f'
const TW_NIGHT = '#0a0d14'

// Day/twilight/night bar for one calendar day (00:00–24:00). Twilight bands come
// from real solar geometry (sun.ts altitude thresholds 0/-6/-12/-18°), anchored to
// the API's accurate sunrise/sunset. Only depths the sun ACTUALLY reaches produce a
// band; the deepest reached band fills across solar midnight — so e.g. a location
// with no true astronomical darkness shows astronomical twilight at midnight, never
// a night band. Rendered as hard-edged bands (each stop repeated) for crisp contrast.
function buildTwilightBar(lat: number | null, date: string, sunrise: string, sunset: string): string {
  if (lat === null || sunrise === '--:--' || sunset === '--:--') {
    // No location, or polar day/night (no sun events): solid fill, no fake gradient.
    return sunrise === '--:--' && sunset === '--:--' ? TW_NIGHT : TW_DAY
  }

  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const sunriseMin = toMin(sunrise)
  const sunsetMin = toMin(sunset)
  const doy = dayOfYear(new Date(date + 'T12:00:00'))

  const horizon = altitudeCrossing(lat, doy, 0)
  if (horizon.kind !== 'crosses') {
    return horizon.kind === 'alwaysAbove' ? TW_DAY : TW_NIGHT
  }

  // Depths below each twilight threshold, deepening. For each depth the sun reaches,
  // record minutes from sunset to that depth (= minutes before sunrise, by symmetry).
  // Once a depth is never reached, the deeper ones can't be either, so stop.
  const DEPTHS = [
    { alt: -6, color: TW_NAUTICAL },
    { alt: -12, color: TW_ASTRO },
    { alt: -18, color: TW_NIGHT },
  ]
  const reached: { offset: number; color: string }[] = []
  for (const d of DEPTHS) {
    const c = altitudeCrossing(lat, doy, d.alt)
    if (c.kind !== 'crosses') break
    reached.push({ offset: (c.evening - horizon.evening) * 60, color: d.color })
  }

  const deepest = reached.length ? reached[reached.length - 1] : null
  const centerColor = deepest ? deepest.color : TW_CIVIL
  const centerOffset = deepest ? deepest.offset : 0

  const pct = (min: number) => Math.max(0, Math.min(100, (min / 1440) * 100)).toFixed(2)
  const stops: string[] = []
  const band = (color: string, fromMin: number, toMin2: number) => {
    stops.push(`${color} ${pct(fromMin)}%`, `${color} ${pct(toMin2)}%`)
  }

  // Pre-dawn: deepest band from midnight, lightening up to sunrise.
  band(centerColor, 0, sunriseMin - centerOffset)
  for (let i = reached.length - 1; i >= 1; i--) {
    band(reached[i - 1].color, sunriseMin - reached[i].offset, sunriseMin - reached[i - 1].offset)
  }
  if (reached.length) band(TW_CIVIL, sunriseMin - reached[0].offset, sunriseMin)

  // Daylight.
  band(TW_DAY, sunriseMin, sunsetMin)

  // Dusk: darken from sunset to the deepest band, which then runs to midnight.
  if (reached.length) band(TW_CIVIL, sunsetMin, sunsetMin + reached[0].offset)
  for (let i = 1; i < reached.length; i++) {
    band(reached[i - 1].color, sunsetMin + reached[i - 1].offset, sunsetMin + reached[i].offset)
  }
  band(centerColor, sunsetMin + centerOffset, 1440)

  return `linear-gradient(to right, ${stops.join(', ')})`
}

function buildMoonBarGradient(date: string, sunrise: string, illumination: number): string {
  if (sunrise === '--:--') return '#0d1117'

  const parseTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return ((h * 60 + m) / (24 * 60)) * 100
  }

  const dt = new Date(date + 'T12:00:00')
  const knownNewMoon = new Date('2000-01-06T18:14:00Z')
  const synodicMonth = 29.53059
  const daysSinceNew = (dt.getTime() - knownNewMoon.getTime()) / (1000 * 60 * 60 * 24)
  const phaseRatio = (((daysSinceNew % synodicMonth) + synodicMonth) % synodicMonth) / synodicMonth

  const sunrisePos = parseTime(sunrise)

  const moonrise = (sunrisePos + phaseRatio * 100) % 100
  const moonset = (moonrise + 50) % 100

  const tw = 3
  const night = '#0d1117'
  const b = Math.min(160, Math.round(40 + illumination * 1.2))
  const hex = b.toString(16).padStart(2, '0')
  const moonColor = `#${hex}${hex}${hex}`

  const p = (v: number) => `${Math.max(0, Math.min(100, v)).toFixed(1)}%`

  const lw = 0.3

  if (moonrise < moonset) {
    const peak = (moonrise + moonset) / 2
    return `linear-gradient(to right, ${night} ${p(moonrise - tw)}, ${moonColor} ${p(moonrise + tw)}, ${moonColor} ${p(peak - lw)}, ${night} ${p(peak)}, ${moonColor} ${p(peak + lw)}, ${moonColor} ${p(moonset - tw)}, ${night} ${p(moonset + tw)})`
  } else {
    const peak = ((moonrise + moonset + 100) / 2) % 100
    if (peak > moonrise || peak < moonset) {
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
  lat: number | null
  collapsed: boolean
  onToggle: () => void
  onCloudCell: (e: React.MouseEvent<HTMLDivElement>, h: HourData, type: CloudKey, pinned: boolean) => void
  onCloudLeave: () => void
}

function DayCard({ day, lat, collapsed, onToggle, onCloudCell, onCloudLeave }: DayCardProps) {
  if (day.hours.length === 0) return null

  return (
    <div className="weather-day-card">
      <div className="weather-day-row">
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
          <div className="weather-sun-bar" style={{ background: buildTwilightBar(lat, day.date, day.sunrise, day.sunset) }} />
          <div className="weather-sun-bar" style={{ background: buildMoonBarGradient(day.date, day.sunrise, day.moonIllumination) }} />
          {!collapsed && (
            <div className="weather-data-rows">
              {ROWS.map((row) => (
                <div key={row.label} className="weather-data-row">
                  {day.hours.map((h, i) => (
                    <div
                      key={i}
                      className={`weather-cell ${h.isNight ? 'night' : ''}${h.isPast ? ' past' : ''}`}
                      style={{ backgroundColor: row.getColor(h) }}
                      {...(row.cloudType ? {
                        'data-cloud-type': row.cloudType,
                        onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => onCloudCell(e, h, row.cloudType!, false),
                        onMouseLeave: onCloudLeave,
                        onClick: (e: React.MouseEvent<HTMLDivElement>) => onCloudCell(e, h, row.cloudType!, true),
                      } : {})}
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

function CloudPopover({ pop, onClose }: { pop: PopoverState; onClose: () => void }) {
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // A pinned popover closes on any click outside both the popover itself
    // and any cloud cell (a click on a different cloud cell should redirect
    // the pin instead of being swallowed here).
    const onDocClick = (e: MouseEvent) => {
      if (!pop.pinned) return
      const target = e.target as HTMLElement | null
      if (popoverRef.current?.contains(target)) return
      if (target?.closest('[data-cloud-type]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    document.addEventListener('click', onDocClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      document.removeEventListener('click', onDocClick)
    }
  }, [onClose, pop.pinned])

  const width = 170
  const left = Math.max(4, Math.min(pop.x - width / 2, window.innerWidth - width - 4))
  return (
    <div ref={popoverRef} className="weather-popover" style={{ left, top: pop.y + 6, width }}>
      {pop.hour.cloudModels.map((m) => {
        const val = m[pop.type]
        return (
          <div key={m.id} className="weather-popover-row">
            <span className="weather-popover-label">{m.label}</span>
            <span
              className="weather-popover-chip"
              style={val !== null ? { backgroundColor: getCloudColor(val) } : undefined}
            >
              {val === null ? '—' : `${Math.round(val)}%`}
            </span>
            <span className="weather-popover-weight">×{m.weight.toFixed(2)}</span>
          </div>
        )
      })}
      {(() => {
        const blend = BLEND_FIELD[pop.type](pop.hour)
        return (
          <div className="weather-popover-row blend">
            <span className="weather-popover-label">Blend</span>
            <span
              className="weather-popover-chip"
              style={blend !== null ? { backgroundColor: getCloudColor(blend) } : undefined}
            >
              {blend === null ? '—' : `${Math.round(blend)}%`}
            </span>
            <span className="weather-popover-weight" />
          </div>
        )
      })()}
    </div>
  )
}
