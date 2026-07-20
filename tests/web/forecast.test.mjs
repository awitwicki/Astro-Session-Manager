import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTwilightBar, buildMoonBarGradient } from '../../docs/astroweather/js/forecast.js'

test('no location → flat day color; polar day/night times → solid fills', () => {
  assert.equal(buildTwilightBar(null, '2026-07-20', '05:12', '20:45'), '#e8b830')
  assert.equal(buildTwilightBar(null, '2026-07-20', '--:--', '--:--'), '#0a0d14')
})

test('60°N midsummer: gradient reaches nautical twilight but never astro/night', () => {
  const g = buildTwilightBar(60, '2026-06-21', '03:30', '22:30')
  assert.ok(g.startsWith('linear-gradient(to right,'))
  assert.ok(g.includes('#3f6196'))   // nautical twilight reached
  assert.ok(!g.includes('#22324f'))  // astro twilight never reached
  assert.ok(!g.includes('#0a0d14'))  // no true night band
})

test('50°N midwinter reaches full astronomical night', () => {
  const g = buildTwilightBar(50, '2026-01-15', '07:50', '16:30')
  assert.ok(g.includes('#0a0d14'))
})

test('moon bar is solid night when there is no sunrise anchor', () => {
  assert.equal(buildMoonBarGradient('2026-07-20', '--:--', 50), '#0d1117')
})

test('moon bar is a gradient on a normal day', () => {
  const g = buildMoonBarGradient('2026-07-20', '05:12', 80)
  assert.ok(g.startsWith('linear-gradient(to right,'))
})
