import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getMoonPhase, getCloudColor, getTempColor, getWindArrow, processForecast,
  blendValues, currentHourClouds, CLOUD_MODELS,
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

// 24 hours of one day in the suffixed multi-model shape the API returns
// when several models are requested. Non-cloud variables exist only for
// ALADIN (the primary model); cloud variables exist for all three.
function multiModelFixture() {
  const times = Array.from({ length: 24 }, (_, i) => `2026-07-20T${String(i).padStart(2, '0')}:00`)
  const fill = (v) => Array(24).fill(v)
  const hourly = { time: times }
  for (const [name, v] of Object.entries({
    temperature_2m: 15, relative_humidity_2m: 60, dew_point_2m: 8,
    apparent_temperature: 15, wind_speed_10m: 4, wind_direction_10m: 90,
    visibility: 20000, precipitation_probability: 0, precipitation: 0,
  })) hourly[`${name}_chmi_aladin_seamless`] = fill(v)
  const totals = { chmi_aladin_seamless: 10, ecmwf_ifs025: 30, icon_eu: 50 }
  for (const [model, v] of Object.entries(totals)) {
    hourly[`cloud_cover_${model}`] = fill(v)
    hourly[`cloud_cover_low_${model}`] = fill(v)
    hourly[`cloud_cover_mid_${model}`] = fill(0)
    hourly[`cloud_cover_high_${model}`] = fill(0)
  }
  return {
    hourly,
    daily: {
      time: ['2026-07-20'],
      sunrise_chmi_aladin_seamless: ['2026-07-20T05:12'],
      sunset_chmi_aladin_seamless: ['2026-07-20T20:45'],
    },
    timezone: 'auto',
  }
}

test('CLOUD_MODELS weights sum to 1', () => {
  const sum = CLOUD_MODELS.reduce((s, m) => s + m.weight, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9)
})

test('blendValues computes a renormalized weighted mean', () => {
  // 10·0.32 + 30·0.44 + 50·0.24 = 28.4 → 28
  assert.equal(blendValues([
    { value: 10, weight: 0.32 },
    { value: 30, weight: 0.44 },
    { value: 50, weight: 0.24 },
  ]), 28)
  // ICON missing: (10·0.32 + 30·0.44) / 0.76 = 21.58 → 22
  assert.equal(blendValues([
    { value: 10, weight: 0.32 },
    { value: 30, weight: 0.44 },
    { value: null, weight: 0.24 },
  ]), 22)
  assert.equal(blendValues([
    { value: null, weight: 0.32 },
    { value: null, weight: 0.44 },
    { value: null, weight: 0.24 },
  ]), null)
})

test('processForecast blends clouds, keeps ALADIN for the rest, groups and flags', () => {
  const days = processForecast(multiModelFixture(), new Date('2026-07-20T12:00:00'))
  assert.equal(days.length, 1)
  const day = days[0]
  assert.equal(day.hours.length, 24)
  assert.equal(day.sunrise, '05:12')
  assert.equal(day.sunset, '20:45')
  const h = day.hours[0]
  assert.equal(h.cloudCover, 28)      // blend of 10/30/50
  assert.equal(h.cloudCoverLow, 28)
  assert.equal(h.cloudCoverMid, 0)
  assert.equal(h.cloudCoverHigh, 0)
  assert.equal(h.temperature, 15)     // straight from ALADIN
  assert.equal(h.visibility, 20000)
  assert.equal(h.cloudModels.length, 3)
  assert.deepEqual(h.cloudModels[0], {
    id: 'aladin', label: 'ALADIN', weight: 0.32, total: 10, low: 10, mid: 0, high: 0,
  })
  assert.equal(day.hours[3].isNight, true)
  assert.equal(day.hours[12].isNight, false)
  assert.equal(day.hours[3].isPast, true)
  assert.equal(day.hours[12].isPast, false)
  assert.ok(day.moonEmoji.length > 0)
})

test('processForecast renormalizes when one model has null hours', () => {
  const data = multiModelFixture()
  data.hourly.cloud_cover_icon_eu = Array(24).fill(null)
  data.hourly.cloud_cover_low_icon_eu = Array(24).fill(null)
  const days = processForecast(data, new Date('2026-07-20T12:00:00'))
  assert.equal(days[0].hours[0].cloudCover, 22) // (10·0.32 + 30·0.44) / 0.76
  assert.equal(days[0].hours[0].cloudModels[2].total, null)
})

test('processForecast produces a null blend when every model reports no cloud data', () => {
  // Regression test for the "Blend" row null-safety fix: blendValues()
  // genuinely returns null when all three models are null for an hour, and
  // that must propagate through processForecast rather than being coerced.
  const data = multiModelFixture()
  for (const model of ['chmi_aladin_seamless', 'ecmwf_ifs025', 'icon_eu']) {
    for (const field of ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high']) {
      data.hourly[`${field}_${model}`] = Array(24).fill(null)
    }
  }
  const days = processForecast(data, new Date('2026-07-20T12:00:00'))
  const h = days[0].hours[0]
  assert.equal(h.cloudCover, null)
  assert.equal(h.cloudCoverLow, null)
  assert.equal(h.cloudCoverMid, null)
  assert.equal(h.cloudCoverHigh, null)
  assert.ok(h.cloudModels.every((m) => m.total === null && m.low === null && m.mid === null && m.high === null))
})

test('processForecast falls back per field when ALADIN is out of domain', () => {
  // East of ~32°E the location leaves ALADIN's domain and Open-Meteo omits
  // every _chmi_aladin_seamless array (daily and hourly) from the response.
  // ECMWF is global but returns visibility as all-null; ICON-EU has it.
  const times = Array.from({ length: 24 }, (_, i) => `2026-07-20T${String(i).padStart(2, '0')}:00`)
  const fill = (v) => Array(24).fill(v)
  const hourly = { time: times }
  for (const [name, v] of Object.entries({
    temperature_2m: 20, relative_humidity_2m: 55, dew_point_2m: 10,
    apparent_temperature: 20, wind_speed_10m: 6, wind_direction_10m: 45,
    precipitation_probability: 5, precipitation: 0,
  })) hourly[`${name}_ecmwf_ifs025`] = fill(v)
  hourly.visibility_ecmwf_ifs025 = fill(null)
  hourly.visibility_icon_eu = fill(30000)
  for (const model of ['ecmwf_ifs025', 'icon_eu']) {
    for (const field of ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high']) {
      hourly[`${field}_${model}`] = fill(40)
    }
  }
  const data = {
    hourly,
    daily: {
      time: ['2026-07-20'],
      sunrise_ecmwf_ifs025: ['2026-07-20T05:30'],
      sunset_ecmwf_ifs025: ['2026-07-20T20:10'],
      sunrise_icon_eu: ['2026-07-20T05:30'],
      sunset_icon_eu: ['2026-07-20T20:10'],
    },
    timezone: 'auto',
  }
  const days = processForecast(data, new Date('2026-07-20T12:00:00'))
  assert.equal(days.length, 1)
  const day = days[0]
  assert.equal(day.sunrise, '05:30')
  assert.equal(day.sunset, '20:10')
  const h = day.hours[0]
  assert.equal(h.temperature, 20)     // ECMWF, next model after missing ALADIN
  assert.equal(h.visibility, 30000)   // ICON-EU: ECMWF's visibility is all-null
  assert.equal(h.cloudCover, 40)
  assert.equal(h.cloudModels[0].total, null) // ALADIN breakdown stays empty
  assert.equal(day.hours[3].isNight, true)
  assert.equal(day.hours[12].isNight, false)
})

test('currentHourClouds finds the breakdown for the current hour', () => {
  const days = processForecast(multiModelFixture(), new Date('2026-07-20T12:00:00'))
  const now = currentHourClouds(days, new Date('2026-07-20T21:30:00'))
  assert.equal(now.hour, 21)
  assert.equal(now.blend, 28)
  assert.equal(now.models.length, 3)
  assert.equal(currentHourClouds(days, new Date('2026-09-01T00:00:00')), null)
  assert.equal(currentHourClouds(null, new Date('2026-07-20T12:00:00')), null)
})
