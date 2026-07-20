import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getMoonPhase, getCloudColor, getTempColor, getWindArrow, processForecast,
} from '../../docs/astroweather/js/weather.js'

test('moon phase at the reference new moon and following full moon', () => {
  const nm = getMoonPhase(new Date('2000-01-06T18:14:00Z'))
  assert.equal(nm.name, 'New Moon')
  assert.ok(nm.illumination <= 2)
  const fm = getMoonPhase(new Date('2000-01-21T04:40:00Z'))
  assert.ok(fm.illumination >= 95)
})

test('color scales hit expected buckets', () => {
  assert.equal(getCloudColor(0), '#2d8a4e')
  assert.equal(getCloudColor(100), '#c44040')
  assert.equal(getTempColor(-20), '#4a7ab5')
})

test('wind arrow points where the wind blows to', () => {
  assert.equal(getWindArrow(0), '↓')
  assert.equal(getWindArrow(180), '↑')
})

test('processForecast groups hours per day and flags night/past', () => {
  const times = Array.from({ length: 24 }, (_, i) => `2026-07-20T${String(i).padStart(2, '0')}:00`)
  const fill = (v) => Array(24).fill(v)
  const data = {
    hourly: {
      time: times,
      temperature_2m: fill(15), relative_humidity_2m: fill(60), dew_point_2m: fill(8),
      apparent_temperature: fill(15), cloud_cover: fill(10), cloud_cover_low: fill(5),
      cloud_cover_mid: fill(5), cloud_cover_high: fill(5), wind_speed_10m: fill(4),
      wind_direction_10m: fill(90), visibility: fill(20000),
      precipitation_probability: fill(0), precipitation: fill(0),
    },
    daily: { time: ['2026-07-20'], sunrise: ['2026-07-20T05:12'], sunset: ['2026-07-20T20:45'] },
    timezone: 'auto',
  }
  const days = processForecast(data, new Date('2026-07-20T12:00:00'))
  assert.equal(days.length, 1)
  const day = days[0]
  assert.equal(day.hours.length, 24)
  assert.equal(day.sunrise, '05:12')
  assert.equal(day.sunset, '20:45')
  assert.equal(day.dayNumber, 20)
  assert.equal(day.hours[3].isNight, true)   // 03:00, before sunrise
  assert.equal(day.hours[12].isNight, false) // noon
  assert.equal(day.hours[3].isPast, true)    // before the 12:00 "now"
  assert.equal(day.hours[12].isPast, false)
  assert.ok(day.moonEmoji.length > 0)
  assert.ok(day.moonIllumination >= 0 && day.moonIllumination <= 100)
})
