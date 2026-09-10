// Open-Meteo client + moon phase + color scales, ported from src/lib/weather.ts.
// Pure module (fetch aside) — no DOM; Node imports it in tests.

import { dayPhases, dayOfYear } from './sun.js'

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
const FETCH_TIMEOUT_MS = 20_000
const FORECAST_DAYS = 7

// Cloud blend models. Weights ∝ 1 / night-MAE from the 2026-08-08 accuracy
// audit at the primary observing site — see
// .claude/skills/weather-model-audit/SKILL.md. Cloud rows show the weighted
// blend; every other variable comes from the first model in this order with
// usable data — normally ALADIN, the only one carrying all 13 variables
// (ECMWF lacks visibility) — via pickColumn below.
export const CLOUD_MODELS = [
  { id: 'aladin', label: 'ALADIN', apiId: 'chmi_aladin_seamless', weight: 0.32 },
  { id: 'ecmwf', label: 'ECMWF', apiId: 'ecmwf_ifs025', weight: 0.44 },
  { id: 'icon_eu', label: 'ICON-EU', apiId: 'icon_eu', weight: 0.24 },
]
// Outside a model's domain Open-Meteo omits its arrays entirely (ALADIN
// covers Central Europe only, roughly up to 32°E), and ECMWF returns
// visibility as an all-null array. For each non-cloud field, use the first
// model in CLOUD_MODELS order (ALADIN → ECMWF → ICON-EU) that has any data.
function pickColumn(section, name) {
  for (const m of CLOUD_MODELS) {
    const arr = section[`${name}_${m.apiId}`]
    if (arr?.some((v) => v !== null && v !== undefined)) return arr
  }
  return null
}

// Weighted mean over non-null entries, renormalized to the present weights.
export function blendValues(entries) {
  let sum = 0
  let wsum = 0
  for (const e of entries) {
    if (e.value === null || e.value === undefined) continue
    sum += e.value * e.weight
    wsum += e.weight
  }
  return wsum > 0 ? Math.round(sum / wsum) : null
}

function forecastParams(lat, lon, modelIds) {
  return new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [
      'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
      'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
      'wind_speed_10m', 'wind_direction_10m', 'visibility',
      'precipitation_probability', 'precipitation',
    ].join(','),
    daily: 'sunrise,sunset',
    forecast_days: String(FORECAST_DAYS),
    timezone: 'auto',
    models: modelIds.join(','),
  })
}

// A stalled mobile connection should fail over, not spin forever. Older
// browsers without AbortSignal.timeout simply get no deadline.
function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
}

async function fetchJson(params) {
  const res = await fetch(`${OPEN_METEO_URL}?${params}`, { signal: timeoutSignal(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`)
  return res.json()
}

// One combined request normally; but Open-Meteo rejects the WHOLE request
// (HTTP 400) when any single requested model is unavailable, so on failure
// retry each model on its own and merge whatever answered. Throws only when
// every model failed — the caller then falls back to buildOfflineForecast.
export async function fetchForecast(lat, lon) {
  let combinedError
  try {
    return processForecast(await fetchJson(forecastParams(lat, lon, CLOUD_MODELS.map((m) => m.apiId))))
  } catch (err) {
    combinedError = err
  }
  const settled = await Promise.allSettled(
    CLOUD_MODELS.map((m) => fetchJson(forecastParams(lat, lon, [m.apiId]))),
  )
  const responses = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.hourly?.time && r.value?.daily?.time) {
      responses.push({ apiId: CLOUD_MODELS[i].apiId, data: r.value })
    }
  })
  if (responses.length === 0) throw combinedError
  return processForecast(mergeModelResponses(responses))
}

// Single-model responses carry UNsuffixed variable keys; rebuild the
// `<variable>_<model>` multi-model shape processForecast expects. The time
// axes are identical across models for the same query, so the first
// response's `time` arrays are shared.
export function mergeModelResponses(responses) {
  const first = responses[0].data
  const merged = { hourly: { time: first.hourly.time }, daily: { time: first.daily.time }, timezone: first.timezone }
  for (const { apiId, data } of responses) {
    for (const section of ['hourly', 'daily']) {
      for (const [key, arr] of Object.entries(data[section] ?? {})) {
        if (key === 'time') continue
        const suffixed = key.endsWith(`_${apiId}`) ? key : `${key}_${apiId}`
        merged[section][suffixed] = arr
      }
    }
  }
  return merged
}

export function localDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function clockLabel(hours) {
  if (hours === null || hours === undefined) return '--:--'
  const m = Math.round(hours * 60) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Failsafe when Open-Meteo is unreachable: the same day entries the UI
// renders, but computed locally — sunrise/sunset from solar geometry (sun.js)
// in the caller's time zone, moon from the synodic model, no weather hours.
// `tzOffsetHoursAt(date)` supplies the DST-aware offset (see daylight.js).
export function buildOfflineForecast(lat, lon, tzOffsetHoursAt, now = new Date(), days = FORECAST_DAYS) {
  const out = []
  for (let d = 0; d < days; d++) {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 12, 0, 0)
    const phases = dayPhases(lat, lon, dayOfYear(dt), tzOffsetHoursAt(dt))
    const moon = getMoonPhase(dt)
    out.push({
      date: localDateString(dt),
      dayName: dt.toLocaleDateString('en-US', { weekday: 'long' }),
      dayNumber: dt.getDate(),
      sunrise: clockLabel(phases.sunrise),
      sunset: clockLabel(phases.sunset),
      moonPhase: moon.name,
      moonEmoji: moon.emoji,
      moonIllumination: moon.illumination,
      hours: [],
      offline: true,
    })
  }
  return out
}

export function processForecast(data, now = new Date()) {
  const { hourly, daily } = data
  const days = []

  const todayStr = localDateString(now)
  const currentHour = now.getHours()

  const sunTimes = {}
  const sunriseCol = pickColumn(daily, 'sunrise')
  const sunsetCol = pickColumn(daily, 'sunset')
  if (sunriseCol && sunsetCol) {
    for (let i = 0; i < daily.time.length; i++) {
      sunTimes[daily.time[i]] = { sunrise: sunriseCol[i], sunset: sunsetCol[i] }
    }
  }

  // Resolve each non-cloud field's column once, not per hour.
  const hourlyCols = {}
  const hourlyCol = (name) => {
    if (!(name in hourlyCols)) hourlyCols[name] = pickColumn(hourly, name)
    return hourlyCols[name]
  }

  const allHours = hourly.time.map((t, i) => {
    const dt = new Date(t)
    const dateStr = t.slice(0, 10)
    const sun = sunTimes[dateStr]
    let isNight = true
    if (sun) {
      const sunriseMin = parseTimeToMinutes(sun.sunrise)
      const sunsetMin = parseTimeToMinutes(sun.sunset)
      const currentMinutes = dt.getHours() * 60 + dt.getMinutes()
      isNight = currentMinutes < sunriseMin || currentMinutes >= sunsetMin
    }

    const isPast = dateStr === todayStr && dt.getHours() < currentHour

    // With several models requested, every hourly key is suffixed _<model>.
    const v = (name) => {
      const arr = hourlyCol(name)
      const val = arr ? arr[i] : null
      return val === undefined ? null : val
    }
    const cloudModels = CLOUD_MODELS.map((m) => {
      const g = (name) => {
        const arr = hourly[`${name}_${m.apiId}`]
        const val = arr ? arr[i] : null
        return val === undefined || val === null ? null : val
      }
      return {
        id: m.id, label: m.label, weight: m.weight,
        total: g('cloud_cover'), low: g('cloud_cover_low'),
        mid: g('cloud_cover_mid'), high: g('cloud_cover_high'),
      }
    })
    const blendOf = (key) =>
      blendValues(cloudModels.map((m) => ({ value: m[key], weight: m.weight })))

    return {
      time: t,
      hour: dt.getHours(),
      temperature: v('temperature_2m'),
      humidity: v('relative_humidity_2m'),
      dewPoint: v('dew_point_2m'),
      feelsLike: v('apparent_temperature'),
      cloudCover: blendOf('total'),
      cloudCoverLow: blendOf('low'),
      cloudCoverMid: blendOf('mid'),
      cloudCoverHigh: blendOf('high'),
      cloudModels,
      windSpeed: v('wind_speed_10m'),
      windDirection: v('wind_direction_10m'),
      visibility: v('visibility'),
      precipProb: v('precipitation_probability'),
      precipitation: v('precipitation'),
      isNight,
      isPast,
    }
  })

  const hoursByDate = {}
  for (const h of allHours) {
    const dateStr = h.time.slice(0, 10)
    if (!hoursByDate[dateStr]) hoursByDate[dateStr] = []
    hoursByDate[dateStr].push(h)
  }

  for (const dateStr of daily.time) {
    const hours = hoursByDate[dateStr] || []
    const sun = sunTimes[dateStr]
    const dt = new Date(dateStr + 'T12:00:00')
    const moon = getMoonPhase(dt)

    days.push({
      date: dateStr,
      dayName: dt.toLocaleDateString('en-US', { weekday: 'long' }),
      dayNumber: dt.getDate(),
      sunrise: sun ? formatTime(sun.sunrise) : '--:--',
      sunset: sun ? formatTime(sun.sunset) : '--:--',
      moonPhase: moon.name,
      moonEmoji: moon.emoji,
      moonIllumination: moon.illumination,
      hours,
    })
  }

  return days
}

// Breakdown for the current local hour — feeds the Satellite check card.
export function currentHourClouds(forecast, now = new Date()) {
  if (!forecast) return null
  const day = forecast.find((d) => d.date === localDateString(now))
  if (!day || day.offline) return null
  const h = day.hours.find((x) => x.hour === now.getHours())
  if (!h) return null
  return { hour: h.hour, models: h.cloudModels, blend: h.cloudCover }
}

function parseTimeToMinutes(isoTime) {
  const timePart = isoTime.includes('T') ? isoTime.split('T')[1] : isoTime
  const [h, m] = timePart.split(':').map(Number)
  return h * 60 + m
}

function formatTime(isoTime) {
  const timePart = isoTime.includes('T') ? isoTime.split('T')[1] : isoTime
  return timePart.slice(0, 5)
}

// Moon phase calculation using the synodic month.
export function getMoonPhase(date) {
  // Known new moon: January 6, 2000 18:14 UTC
  const knownNewMoon = new Date('2000-01-06T18:14:00Z')
  const synodicMonth = 29.53059

  const daysSinceNew = (date.getTime() - knownNewMoon.getTime()) / (1000 * 60 * 60 * 24)
  const phase = ((daysSinceNew % synodicMonth) + synodicMonth) % synodicMonth
  const phaseRatio = phase / synodicMonth // 0 to 1

  const illumination = Math.round(((1 - Math.cos(phaseRatio * 2 * Math.PI)) / 2) * 100)

  let name
  let emoji
  if (phaseRatio < 0.0625) { name = 'New Moon'; emoji = '🌑' }
  else if (phaseRatio < 0.1875) { name = 'Waxing Crescent'; emoji = '🌒' }
  else if (phaseRatio < 0.3125) { name = 'First Quarter'; emoji = '🌓' }
  else if (phaseRatio < 0.4375) { name = 'Waxing Gibbous'; emoji = '🌔' }
  else if (phaseRatio < 0.5625) { name = 'Full Moon'; emoji = '🌕' }
  else if (phaseRatio < 0.6875) { name = 'Waning Gibbous'; emoji = '🌖' }
  else if (phaseRatio < 0.8125) { name = 'Last Quarter'; emoji = '🌗' }
  else if (phaseRatio < 0.9375) { name = 'Waning Crescent'; emoji = '🌘' }
  else { name = 'New Moon'; emoji = '🌑' }

  return { name, illumination, emoji }
}

// Color mapping utilities.
export function getCloudColor(pct) {
  if (pct <= 20) return '#2d8a4e'
  if (pct <= 40) return '#6baa3a'
  if (pct <= 60) return '#c4a525'
  if (pct <= 80) return '#d4782f'
  return '#c44040'
}

export function getWindColor(speed) {
  if (speed <= 5) return '#2d8a4e'
  if (speed <= 15) return '#6baa3a'
  if (speed <= 25) return '#c4a525'
  if (speed <= 35) return '#d4782f'
  return '#c44040'
}

export function getHumidityColor(pct) {
  if (pct <= 50) return '#2d8a4e'
  if (pct <= 65) return '#6baa3a'
  if (pct <= 80) return '#c4a525'
  if (pct <= 90) return '#d4782f'
  return '#c44040'
}

export function getTempColor(temp) {
  if (temp <= -10) return '#4a7ab5'
  if (temp <= 0) return '#5b9bd5'
  if (temp <= 10) return '#6baa3a'
  if (temp <= 20) return '#c4a525'
  if (temp <= 30) return '#d4782f'
  return '#c44040'
}

export function getPrecipColor(prob) {
  if (prob <= 10) return '#2d8a4e'
  if (prob <= 30) return '#6baa3a'
  if (prob <= 50) return '#c4a525'
  if (prob <= 70) return '#d4782f'
  return '#c44040'
}

export function getVisibilityColor(meters) {
  const km = meters / 1000
  if (km >= 20) return '#2d8a4e'
  if (km >= 10) return '#6baa3a'
  if (km >= 5) return '#c4a525'
  if (km >= 2) return '#d4782f'
  return '#c44040'
}

export function getWindArrow(degrees) {
  // Wind direction is where wind comes FROM; the arrow shows where it blows to.
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘']
  const index = Math.round(degrees / 45) % 8
  return arrows[index]
}
