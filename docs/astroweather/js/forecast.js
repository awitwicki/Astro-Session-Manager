// Weather tab renderer, ported from src/components/astroweather/WeatherForecast.tsx.
// Pure gradient builders are exported for tests; DOM work stays inside render
// functions so Node can import this module.

import {
  getCloudColor, getWindColor, getHumidityColor, getTempColor,
  getPrecipColor, getVisibilityColor, getWindArrow,
} from './weather.js'
import { altitudeCrossing, dayOfYear } from './sun.js'
import { el, emptyState } from './dom.js'

export const ROWS = [
  { label: 'Total Clouds (%)', getValue: (h) => String(Math.round(h.cloudCover)), getColor: (h) => getCloudColor(h.cloudCover) },
  { label: 'Low Clouds (%)', getValue: (h) => String(Math.round(h.cloudCoverLow)), getColor: (h) => getCloudColor(h.cloudCoverLow) },
  { label: 'Mid Clouds (%)', getValue: (h) => String(Math.round(h.cloudCoverMid)), getColor: (h) => getCloudColor(h.cloudCoverMid) },
  { label: 'High Clouds (%)', getValue: (h) => String(Math.round(h.cloudCoverHigh)), getColor: (h) => getCloudColor(h.cloudCoverHigh) },
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
// from real solar geometry (sun.js altitude thresholds 0/-6/-12/-18°), anchored to
// the API's accurate sunrise/sunset. Only depths the sun ACTUALLY reaches produce a
// band; the deepest reached band fills across solar midnight.
export function buildTwilightBar(lat, date, sunrise, sunset) {
  if (lat === null || sunrise === '--:--' || sunset === '--:--') {
    // No location, or polar day/night (no sun events): solid fill, no fake gradient.
    return sunrise === '--:--' && sunset === '--:--' ? TW_NIGHT : TW_DAY
  }

  const toMin = (t) => {
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
  const reached = []
  for (const d of DEPTHS) {
    const c = altitudeCrossing(lat, doy, d.alt)
    if (c.kind !== 'crosses') break
    reached.push({ offset: (c.evening - horizon.evening) * 60, color: d.color })
  }

  const deepest = reached.length ? reached[reached.length - 1] : null
  const centerColor = deepest ? deepest.color : TW_CIVIL
  const centerOffset = deepest ? deepest.offset : 0

  const pct = (min) => Math.max(0, Math.min(100, (min / 1440) * 100)).toFixed(2)
  const stops = []
  const band = (color, fromMin, toMin2) => {
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

export function buildMoonBarGradient(date, sunrise, illumination) {
  if (sunrise === '--:--') return '#0d1117'

  const parseTime = (t) => {
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

  const p = (v) => `${Math.max(0, Math.min(100, v)).toFixed(1)}%`

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

// Which day cards are expanded (collapsed by default), keyed by date string.
const expandedDays = new Set()

export function renderForecast(root, view) {
  root.innerHTML = ''

  if (view.lat === null) {
    root.append(emptyState('No Location Set', 'Pick your coordinates on the map above'))
    return
  }

  const bar = el('div', 'weather-coords')
  const btn = el('button', 'btn btn-primary', view.loading ? 'Loading…' : 'Refresh')
  btn.disabled = !!view.loading
  btn.addEventListener('click', view.onRefresh)
  bar.append(btn)
  root.append(bar)

  if (view.error) root.append(el('div', 'weather-error', view.error))

  if (view.forecast) {
    const days = el('div', 'weather-days')
    for (const day of view.forecast) {
      if (day.hours.length === 0) continue
      days.append(dayCard(day, view))
    }
    root.append(days)
  }
}

function dayCard(day, view) {
  const expanded = expandedDays.has(day.date)
  const card = el('div', 'weather-day-card')
  const row = el('div', 'weather-day-row')

  // Left column: day info, plus row labels when expanded.
  const left = el('div', 'weather-day-left')
  const info = el('div', 'weather-day-info')
  const top = el('div', 'weather-day-top')
  top.append(
    el('span', 'weather-day-number', String(day.dayNumber)),
    el('span', 'weather-day-name', day.dayName),
  )
  const moon = el('div', 'weather-moon-info')
  moon.append(
    el('span', 'weather-moon-emoji', day.moonEmoji),
    el('span', 'weather-moon-pct', `${day.moonIllumination}%`),
  )
  const sunTimes = el('div', 'weather-sun-times')
  sunTimes.append(
    el('span', 'weather-sun-rise', `▲ ${day.sunrise}`),
    el('span', 'weather-sun-set', `▼ ${day.sunset}`),
  )
  info.append(top, moon, sunTimes)
  info.addEventListener('click', () => {
    if (expandedDays.has(day.date)) expandedDays.delete(day.date)
    else expandedDays.add(day.date)
    card.replaceWith(dayCard(day, view))
  })
  left.append(info)
  if (expanded) {
    const labels = el('div', 'weather-labels-col')
    for (const r of ROWS) labels.append(el('div', 'weather-label-cell', r.label))
    left.append(labels)
  }

  // Right: horizontally scrollable grid.
  const grid = el('div', 'weather-day-grid')
  const inner = el('div', 'weather-grid-inner')

  const summaryBar = el('div', 'weather-summary-bar')
  const hoursRow = el('div', 'weather-summary-hours')
  for (const h of day.hours) {
    const cell = el('div', `weather-summary-cell${h.isNight ? ' night' : ''}${h.isPast ? ' past' : ''}`)
    cell.style.backgroundColor = SUMMARY_ROW.getColor(h)
    cell.append(el('span', 'weather-summary-hour', String(h.hour).padStart(2, '0')))
    hoursRow.append(cell)
  }
  summaryBar.append(hoursRow)

  const twilightBar = el('div', 'weather-sun-bar')
  twilightBar.style.background = buildTwilightBar(view.lat, day.date, day.sunrise, day.sunset)
  const moonBar = el('div', 'weather-sun-bar')
  moonBar.style.background = buildMoonBarGradient(day.date, day.sunrise, day.moonIllumination)

  inner.append(summaryBar, twilightBar, moonBar)

  if (expanded) {
    const dataRows = el('div', 'weather-data-rows')
    for (const r of ROWS) {
      const dataRow = el('div', 'weather-data-row')
      for (const h of day.hours) {
        const cell = el('div', `weather-cell${h.isNight ? ' night' : ''}${h.isPast ? ' past' : ''}`, r.getValue(h))
        cell.style.backgroundColor = r.getColor(h)
        dataRow.append(cell)
      }
      dataRows.append(dataRow)
    }
    inner.append(dataRows)
  }

  grid.append(inner)
  row.append(left, grid)
  card.append(row)
  return card
}
