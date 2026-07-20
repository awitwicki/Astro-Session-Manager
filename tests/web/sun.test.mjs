import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  solarDeclinationDeg, altitudeCrossing, dayPhases, dayOfYear, equationOfTimeMinutes,
} from '../../docs/astroweather/js/sun.js'

test('declination peaks near the solstices', () => {
  assert.ok(solarDeclinationDeg(172) > 23)
  assert.ok(solarDeclinationDeg(355) < -23)
})

test('equinox horizon crossings near 6h/18h solar time at lat 50', () => {
  const c = altitudeCrossing(50, 80, 0)
  assert.equal(c.kind, 'crosses')
  assert.ok(Math.abs(c.morning - 6) < 0.5)
  assert.ok(Math.abs(c.evening - 18) < 0.5)
})

test('polar day and polar night at lat 70', () => {
  assert.equal(altitudeCrossing(70, 172, 0).kind, 'alwaysAbove')
  assert.equal(altitudeCrossing(70, 355, 0).kind, 'alwaysBelow')
})

test('dayOfYear at year boundaries', () => {
  assert.equal(dayOfYear(new Date(2026, 0, 1)), 1)
  assert.equal(dayOfYear(new Date(2026, 11, 31)), 365)
})

test('equation of time at day 81 is about -7.53 min', () => {
  assert.ok(Math.abs(equationOfTimeMinutes(81) - -7.53) < 0.01)
})

test('dayPhases at lat 50, lon 0, equinox, UTC: ~12h daylight, ordered bands', () => {
  const p = dayPhases(50, 0, 80, 0)
  assert.ok(Math.abs(p.daylightHours - 12) < 0.5)
  assert.ok(p.civilDusk > p.sunset)
  assert.ok(p.astroDawn < p.sunrise)
  assert.equal(p.sunUpAllDay, false)
  assert.equal(p.sunDownAllDay, false)
  assert.deepEqual(p.bandKinds, ['crosses', 'crosses', 'crosses', 'crosses'])
})
