import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseHrz, formatHrz, horizonAltAt, setPoint, removePoint, isHorizonProfile,
  nearestFreeAz, visibilityWindows, clearsHorizonAtNight,
} from '../../src/lib/horizon.ts'
import { altAzCurve } from '../../src/lib/ephemeris.ts'

test('parses the canonical N.I.N.A. example', () => {
  const { profile, warnings } = parseHrz('# Az Alt\n0 14\n5 69\n55 77\n90 70\n360 14\n', 'home.hrz')
  assert.equal(warnings.length, 0)
  assert.equal(profile.name, 'home.hrz')
  // 360 collapses onto 0, which already exists, so 4 distinct azimuths remain
  assert.deepEqual(profile.points.map((p) => p.az), [0, 5, 55, 90])
  assert.equal(profile.points[0].alt, 14)
})

test('accepts tabs and commas, ignores comments and blank lines', () => {
  const { profile } = parseHrz('# header\n\n0\t10\n90,20\n180 30\n  \n270 40 # trailing\n')
  assert.deepEqual(profile.points.map((p) => p.az), [0, 90, 180, 270])
  assert.equal(profile.points[3].alt, 40)
})

test('sorts out-of-order input and reports repairs', () => {
  const { profile, warnings } = parseHrz('180 30\n0 10\n180 35\n90 -5\nbogus line\n270 120\n')
  assert.deepEqual(profile.points.map((p) => p.az), [0, 90, 180, 270])
  assert.equal(profile.points[1].alt, 0, 'negative altitude clamps to 0')
  assert.equal(profile.points[2].alt, 35, 'later duplicate azimuth wins')
  assert.equal(profile.points[3].alt, 90, 'altitude above 90 clamps to 90')
  assert.ok(warnings.some((w) => w.includes('malformed')))
  assert.ok(warnings.some((w) => w.includes('duplicate')))
  assert.ok(warnings.some((w) => w.includes('clamped')))
})

test('fewer than two usable points is a hard failure', () => {
  const r = parseHrz('# only a comment\n0 10\n')
  assert.equal(r.profile, null)
  assert.ok(r.warnings.some((w) => w.includes('at least two')))
})

test('format round-trips through parse unchanged', () => {
  const src = parseHrz('0 14\n5 69.5\n55 77\n90 70\n').profile
  const again = parseHrz(formatHrz(src)).profile
  assert.deepEqual(again.points, src.points)
  assert.ok(formatHrz(src).startsWith('# Az Alt'))
})

test('interpolates linearly between points', () => {
  const p = parseHrz('0 10\n100 30\n').profile
  assert.equal(horizonAltAt(p, 0), 10)
  assert.equal(horizonAltAt(p, 100), 30)
  assert.equal(horizonAltAt(p, 50), 20)
})

test('interpolates across the 0/360 seam', () => {
  // last point 270 -> first point 0 spans 90 degrees of azimuth
  const p = parseHrz('0 10\n270 40\n').profile
  assert.equal(horizonAltAt(p, 315), 25, 'halfway from 270 back round to 0')
  assert.equal(horizonAltAt(p, 360), 10, '360 is the same direction as 0')
  assert.equal(horizonAltAt(p, -45), 25, 'negative azimuth wraps')
})

test('setPoint adds, replaces and keeps sort order', () => {
  const p = parseHrz('0 10\n180 20\n').profile
  const added = setPoint(p, 90, 45)
  assert.deepEqual(added.points.map((q) => q.az), [0, 90, 180])
  const replaced = setPoint(added, 90, 5)
  assert.equal(replaced.points[1].alt, 5)
  assert.deepEqual(replaced.points.map((q) => q.az), [0, 90, 180])
  assert.equal(setPoint(p, 90.4, 12).points[1].az, 90, 'azimuth snaps to whole degrees')
  assert.equal(setPoint(p, 90, 200).points[1].alt, 90, 'altitude clamps')
})

test('removePoint refuses to go below two points', () => {
  const three = parseHrz('0 10\n90 20\n180 30\n').profile
  assert.deepEqual(removePoint(three, 90).points.map((q) => q.az), [0, 180])
  const two = parseHrz('0 10\n180 20\n').profile
  assert.deepEqual(removePoint(two, 180).points, two.points, 'unchanged at the floor')
})

test('nearestFreeAz passes through an azimuth nobody else holds', () => {
  assert.equal(nearestFreeAz([0, 90, 180], 45), 45)
  assert.equal(nearestFreeAz([0, 90, 180], 45.6), 46, 'snaps to a whole degree first')
})

test('nearestFreeAz steps off a collision to the nearest open degree', () => {
  assert.equal(nearestFreeAz([0, 90, 180], 90), 91, 'prefers stepping up first')
  assert.equal(nearestFreeAz([0, 89, 90, 91, 180], 90), 92, 'both neighbors taken: widens the search')
})

test('nearestFreeAz wraps across the 0/360 seam', () => {
  assert.equal(nearestFreeAz([0, 180], 360), 1, 'az 360 normalises to 0, which is taken')
  assert.equal(nearestFreeAz([358, 359], 359), 0, 'steps up, wrapping past 359 back to 0')
  assert.equal(nearestFreeAz([0, 1], 0), 359, 'up also taken: steps down, wrapping below 0 to 359')
})

test('nearestFreeAz with the whole circle taken but one gap returns that gap', () => {
  const allButOne = Array.from({ length: 359 }, (_, i) => i) // 0..358, only 359 free
  assert.equal(nearestFreeAz(allButOne, 0), 359)
})

test('isHorizonProfile guards stored settings', () => {
  assert.ok(isHorizonProfile({ points: [{ az: 0, alt: 1 }, { az: 9, alt: 2 }], name: null }))
  assert.ok(!isHorizonProfile(null))
  assert.ok(!isHorizonProfile({ points: [{ az: 0, alt: 1 }], name: null }), 'needs two points')
  assert.ok(!isHorizonProfile({ points: [{ az: 'a', alt: 1 }, { az: 9, alt: 2 }] }))
})

// Builds a synthetic curve: one sample per hour, altitude given, azimuth fixed
// at 90 so a flat-at-that-azimuth horizon is easy to reason about.
const curveFrom = (alts, az = 90) =>
  alts.map((alt, i) => ({ time: new Date(Date.UTC(2026, 0, 1, i)), alt, az }))

test('visibilityWindows with no profile uses the 0 degree horizon', () => {
  const w = visibilityWindows(curveFrom([-10, 10, 20, -10]), null)
  assert.equal(w.length, 1)
  // rises between hour 0 and 1, sets between hour 2 and 3
  assert.ok(w[0].start.getTime() > Date.UTC(2026, 0, 1, 0))
  assert.ok(w[0].start.getTime() < Date.UTC(2026, 0, 1, 1))
  assert.ok(w[0].end.getTime() > Date.UTC(2026, 0, 1, 2))
})

test('visibilityWindows respects an obstruction', () => {
  const flat20 = { points: [{ az: 0, alt: 20 }, { az: 180, alt: 20 }], name: null }
  // peaks at 15 degrees, which clears 0 but never clears a 20 degree treeline
  assert.equal(visibilityWindows(curveFrom([-5, 10, 15, 10, -5]), flat20).length, 0)
  assert.equal(visibilityWindows(curveFrom([-5, 10, 15, 10, -5]), null).length, 1)
})

test('visibilityWindows splits when the target dips behind an obstruction', () => {
  const flat20 = { points: [{ az: 0, alt: 20 }, { az: 180, alt: 20 }], name: null }
  const w = visibilityWindows(curveFrom([0, 30, 10, 30, 0]), flat20)
  assert.equal(w.length, 2, 'two windows either side of the dip')
  assert.ok(w[0].end.getTime() <= w[1].start.getTime())
})

test('visibilityWindows keeps a window open at the end of the curve', () => {
  const w = visibilityWindows(curveFrom([-5, 10, 20]), null)
  assert.equal(w.length, 1)
  assert.equal(w[0].end.getTime(), Date.UTC(2026, 0, 1, 2))
})

test('clearsHorizonAtNight ignores daytime', () => {
  const flat10 = { points: [{ az: 0, alt: 10 }, { az: 180, alt: 10 }], name: null }
  const curve = curveFrom([40, 40, 5, 5])
  const sunUpFirstHalf = [{ alt: 20 }, { alt: 20 }, { alt: -20 }, { alt: -20 }]
  // only clears while the sun is up, so at night it never clears
  assert.equal(clearsHorizonAtNight(curve, sunUpFirstHalf, flat10), false)
  const sunDown = [{ alt: -20 }, { alt: -20 }, { alt: -20 }, { alt: -20 }]
  assert.equal(clearsHorizonAtNight(curve, sunDown, flat10), true)
})

test('altAzCurve returns azimuth alongside altitude', () => {
  const c = altAzCurve(37.95, 89.264, new Date('2026-01-15T00:00:00Z'), 50, 20)
  assert.equal(c.length, 145)
  assert.ok(c.every((p) => typeof p.az === 'number' && p.time instanceof Date))
  assert.ok(c.every((p) => Math.abs(p.alt - 50) < 1.5), 'Polaris sits at the latitude')
})
