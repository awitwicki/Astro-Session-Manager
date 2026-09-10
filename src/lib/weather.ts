// Open-Meteo API types and utilities for astro weather forecast

import { dayPhases, dayOfYear } from './sun'

export interface OpenMeteoResponse {
  hourly: { time: string[] } & { [key: string]: (number | null)[] | string[] }
  daily: { time: string[] } & { [key: string]: string[] }
  timezone: string
}

export interface CloudModelBreakdown {
  id: 'aladin' | 'ecmwf' | 'icon_eu'
  label: string
  weight: number
  total: number | null
  low: number | null
  mid: number | null
  high: number | null
}

export interface HourData {
  time: string       // ISO datetime
  hour: number       // 0-23
  temperature: number
  humidity: number
  dewPoint: number
  feelsLike: number
  cloudCover: number
  cloudCoverLow: number
  cloudCoverMid: number
  cloudCoverHigh: number
  cloudModels: CloudModelBreakdown[]
  windSpeed: number
  windDirection: number
  visibility: number   // meters
  precipProb: number
  precipitation: number
  isNight: boolean
  isPast: boolean      // true for hours before current hour today
}

export interface DayForecast {
  date: string          // YYYY-MM-DD
  dayName: string       // Monday, Tuesday...
  dayNumber: number     // Day of month (1-31)
  sunrise: string       // HH:MM
  sunset: string        // HH:MM
  moonPhase: string     // Phase name
  moonEmoji: string     // Moon phase emoji
  moonIllumination: number // 0-100
  hours: HourData[]     // 24 hours starting from noon previous day
  offline?: boolean     // built locally because the API was unreachable: sun/moon only, no hours
}

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
const FETCH_TIMEOUT_MS = 20_000
const FORECAST_DAYS = 7

// Cloud blend models. Weights ∝ 1 / night-MAE from the 2026-08-08 accuracy
// audit at the primary observing site — see
// .claude/skills/weather-model-audit/SKILL.md. Cloud rows show the weighted
// blend; every other variable comes from the first model in this order with
// usable data — normally ALADIN, the only one carrying all 13 variables
// (ECMWF lacks visibility) — via pickColumn below.
export const CLOUD_MODELS: Array<{ id: CloudModelBreakdown['id']; label: string; apiId: string; weight: number }> = [
  { id: 'aladin', label: 'ALADIN', apiId: 'chmi_aladin_seamless', weight: 0.32 },
  { id: 'ecmwf', label: 'ECMWF', apiId: 'ecmwf_ifs025', weight: 0.44 },
  { id: 'icon_eu', label: 'ICON-EU', apiId: 'icon_eu', weight: 0.24 },
]

// Outside a model's domain Open-Meteo omits its arrays entirely (ALADIN
// covers Central Europe only, roughly up to 32°E), and ECMWF returns
// visibility as an all-null array. For each non-cloud field, use the first
// model in CLOUD_MODELS order (ALADIN → ECMWF → ICON-EU) that has any data.
function pickColumn(section: { [key: string]: unknown }, name: string): (number | null)[] | string[] | null {
  for (const m of CLOUD_MODELS) {
    const arr = section[`${name}_${m.apiId}`] as (number | null)[] | string[] | undefined
    if (arr?.some((v) => v !== null && v !== undefined)) return arr
  }
  return null
}

// Weighted mean over non-null entries, renormalized to the present weights.
export function blendValues(entries: Array<{ value: number | null; weight: number }>): number | null {
  let sum = 0
  let wsum = 0
  for (const e of entries) {
    if (e.value === null || e.value === undefined) continue
    sum += e.value * e.weight
    wsum += e.weight
  }
  return wsum > 0 ? Math.round(sum / wsum) : null
}

function forecastParams(lat: number, lon: number, modelIds: string[]): URLSearchParams {
  return new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [
      'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
      'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
      'wind_speed_10m', 'wind_direction_10m', 'visibility',
      'precipitation_probability', 'precipitation'
    ].join(','),
    daily: 'sunrise,sunset',
    forecast_days: String(FORECAST_DAYS),
    timezone: 'auto',
    models: modelIds.join(',')
  })
}

// A stalled connection should fail over, not spin forever. Runtimes without
// AbortSignal.timeout simply get no deadline.
function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined
}

async function fetchJson(params: URLSearchParams): Promise<OpenMeteoResponse> {
  const res = await fetch(`${OPEN_METEO_URL}?${params}`, { signal: timeoutSignal(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`)
  return res.json()
}

// One combined request normally; but Open-Meteo rejects the WHOLE request
// (HTTP 400) when any single requested model is unavailable, so on failure
// retry each model on its own and merge whatever answered. Throws only when
// every model failed — the caller then falls back to buildOfflineForecast.
export async function fetchForecast(lat: number, lon: number): Promise<DayForecast[]> {
  let combinedError: unknown
  try {
    return processForecast(await fetchJson(forecastParams(lat, lon, CLOUD_MODELS.map((m) => m.apiId))))
  } catch (err) {
    combinedError = err
  }
  const settled = await Promise.allSettled(
    CLOUD_MODELS.map((m) => fetchJson(forecastParams(lat, lon, [m.apiId])))
  )
  const responses: ModelResponse[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value?.hourly?.time && r.value?.daily?.time) {
      responses.push({ apiId: CLOUD_MODELS[i].apiId, data: r.value })
    }
  })
  if (responses.length === 0) throw combinedError
  return processForecast(mergeModelResponses(responses))
}

export interface ModelResponse {
  apiId: string
  data: OpenMeteoResponse
}

// Single-model responses carry UNsuffixed variable keys; rebuild the
// `<variable>_<model>` multi-model shape processForecast expects. The time
// axes are identical across models for the same query, so the first
// response's `time` arrays are shared.
export function mergeModelResponses(responses: ModelResponse[]): OpenMeteoResponse {
  const first = responses[0].data
  const merged: OpenMeteoResponse = {
    hourly: { time: first.hourly.time },
    daily: { time: first.daily.time },
    timezone: first.timezone,
  }
  for (const { apiId, data } of responses) {
    for (const section of ['hourly', 'daily'] as const) {
      for (const [key, arr] of Object.entries(data[section] ?? {})) {
        if (key === 'time') continue
        const suffixed = key.endsWith(`_${apiId}`) ? key : `${key}_${apiId}`
        ;(merged[section] as Record<string, unknown>)[suffixed] = arr
      }
    }
  }
  return merged
}

export function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function clockLabel(hours: number | null): string {
  if (hours === null) return '--:--'
  const m = Math.round(hours * 60) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Failsafe when Open-Meteo is unreachable: the same day entries the UI
// renders, but computed locally — sunrise/sunset from solar geometry (sun.ts)
// in the caller's time zone, moon from the synodic model, no weather hours.
// `tzOffsetHoursAt(date)` supplies the DST-aware offset (see timezone.ts).
export function buildOfflineForecast(
  lat: number,
  lon: number,
  tzOffsetHoursAt: (date: Date) => number,
  now: Date = new Date(),
  days: number = FORECAST_DAYS,
): DayForecast[] {
  const out: DayForecast[] = []
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

function processForecast(data: OpenMeteoResponse): DayForecast[] {
  const { hourly, daily } = data
  const days: DayForecast[] = []

  // Current time for marking past hours
  const now = new Date()
  const todayStr = localDateString(now)
  const currentHour = now.getHours()

  // Build a map of sunrise/sunset per date
  const sunTimes: Record<string, { sunrise: string; sunset: string }> = {}
  const sunriseCol = pickColumn(daily, 'sunrise') as string[] | null
  const sunsetCol = pickColumn(daily, 'sunset') as string[] | null
  if (sunriseCol && sunsetCol) {
    for (let i = 0; i < daily.time.length; i++) {
      sunTimes[daily.time[i]] = { sunrise: sunriseCol[i], sunset: sunsetCol[i] }
    }
  }

  // Resolve each non-cloud field's column once, not per hour.
  const hourlyCols: Record<string, (number | null)[] | null> = {}
  const hourlyCol = (name: string) => {
    if (!(name in hourlyCols)) hourlyCols[name] = pickColumn(hourly, name) as (number | null)[] | null
    return hourlyCols[name]
  }

  // Build hourly data with night flag
  const allHours: HourData[] = hourly.time.map((t, i) => {
    const dt = new Date(t)
    const dateStr = t.slice(0, 10)
    const sun = sunTimes[dateStr]
    let isNight = true
    if (sun) {
      const sunriseHour = parseTimeToMinutes(sun.sunrise)
      const sunsetHour = parseTimeToMinutes(sun.sunset)
      const currentMinutes = dt.getHours() * 60 + dt.getMinutes()
      isNight = currentMinutes < sunriseHour || currentMinutes >= sunsetHour
    }

    // Mark hours before current hour on today as past
    const isPast = dateStr === todayStr && dt.getHours() < currentHour

    // With several models requested, every hourly key is suffixed _<model>.
    const col = (key: string) => hourly[key] as (number | null)[] | undefined
    const v = (name: string) => {
      const arr = hourlyCol(name)
      return ((arr ? arr[i] : null) ?? null) as number
    }
    const cloudModels: CloudModelBreakdown[] = CLOUD_MODELS.map((m) => {
      const g = (name: string) => {
        const arr = col(`${name}_${m.apiId}`)
        const val = arr ? arr[i] : null
        return val === undefined || val === null ? null : val
      }
      return {
        id: m.id, label: m.label, weight: m.weight,
        total: g('cloud_cover'), low: g('cloud_cover_low'),
        mid: g('cloud_cover_mid'), high: g('cloud_cover_high'),
      }
    })
    const blendOf = (key: 'total' | 'low' | 'mid' | 'high') =>
      blendValues(cloudModels.map((m) => ({ value: m[key], weight: m.weight }))) as number

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
      isPast
    }
  })

  // Group into days (each day: noon to noon, showing that night centered)
  // But simpler: just group by calendar date (0-23h)
  const hoursByDate: Record<string, HourData[]> = {}
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
      hours
    })
  }

  return days
}

// Breakdown for the current local hour — feeds the Satellite check card.
export function currentHourClouds(forecast: DayForecast[] | null, now: Date = new Date()):
  { hour: number; models: CloudModelBreakdown[]; blend: number | null } | null {
  if (!forecast) return null
  const day = forecast.find((d) => d.date === localDateString(now))
  if (!day || day.offline) return null
  const h = day.hours.find((x) => x.hour === now.getHours())
  if (!h) return null
  return { hour: h.hour, models: h.cloudModels, blend: h.cloudCover }
}

function parseTimeToMinutes(isoTime: string): number {
  const timePart = isoTime.includes('T') ? isoTime.split('T')[1] : isoTime
  const [h, m] = timePart.split(':').map(Number)
  return h * 60 + m
}

function formatTime(isoTime: string): string {
  const timePart = isoTime.includes('T') ? isoTime.split('T')[1] : isoTime
  return timePart.slice(0, 5)
}

// Moon phase calculation using synodic month
export function getMoonPhase(date: Date): { name: string; illumination: number; emoji: string } {
  // Known new moon: January 6, 2000 18:14 UTC
  const knownNewMoon = new Date('2000-01-06T18:14:00Z')
  const synodicMonth = 29.53059

  const daysSinceNew = (date.getTime() - knownNewMoon.getTime()) / (1000 * 60 * 60 * 24)
  const phase = ((daysSinceNew % synodicMonth) + synodicMonth) % synodicMonth
  const phaseRatio = phase / synodicMonth // 0 to 1

  // Illumination: 0 at new moon, 1 at full moon
  const illumination = Math.round((1 - Math.cos(phaseRatio * 2 * Math.PI)) / 2 * 100)

  let name: string
  let emoji: string
  if (phaseRatio < 0.0625) { name = 'New Moon'; emoji = '\u{1F311}' }
  else if (phaseRatio < 0.1875) { name = 'Waxing Crescent'; emoji = '\u{1F312}' }
  else if (phaseRatio < 0.3125) { name = 'First Quarter'; emoji = '\u{1F313}' }
  else if (phaseRatio < 0.4375) { name = 'Waxing Gibbous'; emoji = '\u{1F314}' }
  else if (phaseRatio < 0.5625) { name = 'Full Moon'; emoji = '\u{1F315}' }
  else if (phaseRatio < 0.6875) { name = 'Waning Gibbous'; emoji = '\u{1F316}' }
  else if (phaseRatio < 0.8125) { name = 'Last Quarter'; emoji = '\u{1F317}' }
  else if (phaseRatio < 0.9375) { name = 'Waning Crescent'; emoji = '\u{1F318}' }
  else { name = 'New Moon'; emoji = '\u{1F311}' }

  return { name, illumination, emoji }
}

// Color mapping utilities
export function getCloudColor(pct: number): string {
  if (pct <= 20) return '#2d8a4e'
  if (pct <= 40) return '#6baa3a'
  if (pct <= 60) return '#c4a525'
  if (pct <= 80) return '#d4782f'
  return '#c44040'
}

export function getWindColor(speed: number): string {
  if (speed <= 5) return '#2d8a4e'
  if (speed <= 15) return '#6baa3a'
  if (speed <= 25) return '#c4a525'
  if (speed <= 35) return '#d4782f'
  return '#c44040'
}

export function getHumidityColor(pct: number): string {
  if (pct <= 50) return '#2d8a4e'
  if (pct <= 65) return '#6baa3a'
  if (pct <= 80) return '#c4a525'
  if (pct <= 90) return '#d4782f'
  return '#c44040'
}

export function getTempColor(temp: number): string {
  if (temp <= -10) return '#4a7ab5'
  if (temp <= 0) return '#5b9bd5'
  if (temp <= 10) return '#6baa3a'
  if (temp <= 20) return '#c4a525'
  if (temp <= 30) return '#d4782f'
  return '#c44040'
}

export function getPrecipColor(prob: number): string {
  if (prob <= 10) return '#2d8a4e'
  if (prob <= 30) return '#6baa3a'
  if (prob <= 50) return '#c4a525'
  if (prob <= 70) return '#d4782f'
  return '#c44040'
}

export function getVisibilityColor(meters: number): string {
  const km = meters / 1000
  if (km >= 20) return '#2d8a4e'
  if (km >= 10) return '#6baa3a'
  if (km >= 5) return '#c4a525'
  if (km >= 2) return '#d4782f'
  return '#c44040'
}

export function getWindArrow(degrees: number): string {
  // Wind direction is where wind comes FROM, arrow shows direction
  const arrows = ['\u2193', '\u2199', '\u2190', '\u2196', '\u2191', '\u2197', '\u2192', '\u2198']
  const index = Math.round(degrees / 45) % 8
  return arrows[index]
}
