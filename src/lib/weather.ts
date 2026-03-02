// Open-Meteo API types and utilities for astro weather forecast

export interface OpenMeteoResponse {
  hourly: {
    time: string[]
    temperature_2m: number[]
    relative_humidity_2m: number[]
    dew_point_2m: number[]
    apparent_temperature: number[]
    cloud_cover: number[]
    cloud_cover_low: number[]
    cloud_cover_mid: number[]
    cloud_cover_high: number[]
    wind_speed_10m: number[]
    wind_direction_10m: number[]
    visibility: number[]
    precipitation_probability: number[]
    precipitation: number[]
  }
  daily: {
    time: string[]
    sunrise: string[]
    sunset: string[]
  }
  timezone: string
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
}

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

export async function fetchForecast(lat: number, lon: number): Promise<DayForecast[]> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [
      'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'apparent_temperature',
      'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
      'wind_speed_10m', 'wind_direction_10m', 'visibility',
      'precipitation_probability', 'precipitation'
    ].join(','),
    daily: 'sunrise,sunset',
    forecast_days: '7',
    timezone: 'auto'
  })

  const res = await fetch(`${OPEN_METEO_URL}?${params}`)
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`)
  const data: OpenMeteoResponse = await res.json()
  return processForecast(data)
}

function processForecast(data: OpenMeteoResponse): DayForecast[] {
  const { hourly, daily } = data
  const days: DayForecast[] = []

  // Current time for marking past hours
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const currentHour = now.getHours()

  // Build a map of sunrise/sunset per date
  const sunTimes: Record<string, { sunrise: string; sunset: string }> = {}
  for (let i = 0; i < daily.time.length; i++) {
    sunTimes[daily.time[i]] = {
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i]
    }
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

    return {
      time: t,
      hour: dt.getHours(),
      temperature: hourly.temperature_2m[i],
      humidity: hourly.relative_humidity_2m[i],
      dewPoint: hourly.dew_point_2m[i],
      feelsLike: hourly.apparent_temperature[i],
      cloudCover: hourly.cloud_cover[i],
      cloudCoverLow: hourly.cloud_cover_low[i],
      cloudCoverMid: hourly.cloud_cover_mid[i],
      cloudCoverHigh: hourly.cloud_cover_high[i],
      windSpeed: hourly.wind_speed_10m[i],
      windDirection: hourly.wind_direction_10m[i],
      visibility: hourly.visibility[i],
      precipProb: hourly.precipitation_probability[i],
      precipitation: hourly.precipitation[i],
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
