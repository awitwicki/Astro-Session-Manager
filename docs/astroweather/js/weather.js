// Open-Meteo client + moon phase + color scales, ported from src/lib/weather.ts.
// Pure module (fetch aside) — no DOM; Node imports it in tests.

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

// Cloud blend models. Weights ∝ 1 / night-MAE from the 2026-08-08 accuracy
// audit at the primary observing site — see
// .claude/skills/weather-model-audit/SKILL.md. Cloud rows show the weighted
// blend; every other variable comes from PRIMARY (ALADIN), the only blend
// model that carries all 13 variables (ECMWF lacks visibility).
export const CLOUD_MODELS = [
  { id: 'aladin', label: 'ALADIN', apiId: 'chmi_aladin_seamless', weight: 0.32 },
  { id: 'ecmwf', label: 'ECMWF', apiId: 'ecmwf_ifs025', weight: 0.44 },
  { id: 'icon_eu', label: 'ICON-EU', apiId: 'icon_eu', weight: 0.24 },
]
const PRIMARY = 'chmi_aladin_seamless'

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

export async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [
      'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
      'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
      'wind_speed_10m', 'wind_direction_10m', 'visibility',
      'precipitation_probability', 'precipitation',
    ].join(','),
    daily: 'sunrise,sunset',
    forecast_days: '7',
    timezone: 'auto',
    models: CLOUD_MODELS.map((m) => m.apiId).join(','),
  })

  const res = await fetch(`${OPEN_METEO_URL}?${params}`)
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`)
  const data = await res.json()
  return processForecast(data)
}

export function processForecast(data, now = new Date()) {
  const { hourly, daily } = data
  const days = []

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const currentHour = now.getHours()

  const sunTimes = {}
  for (let i = 0; i < daily.time.length; i++) {
    sunTimes[daily.time[i]] = {
      sunrise: daily[`sunrise_${PRIMARY}`][i],
      sunset: daily[`sunset_${PRIMARY}`][i],
    }
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
    const v = (name) => hourly[`${name}_${PRIMARY}`][i]
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
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const day = forecast.find((d) => d.date === dateStr)
  if (!day) return null
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
