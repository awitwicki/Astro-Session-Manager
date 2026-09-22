import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pannedCentre, clampLook, LOOK_ALT_LIMIT } from '../../src/lib/skyPan.ts'
import { separationDeg } from '../../src/lib/ephemeris.ts'

const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol

test('dragging the point under the centre 10° east moves the centre 10° west', () => {
  const [lon, lat] = pannedCentre([0, 0], [0, 0], [10, 0])
  assert.ok(near(lon, -10) && near(lat, 0), `${lon},${lat}`)
})

test('the grabbed point ends up as far from the new centre as the drop point was from the old one', () => {
  const centre = [40, 20], from = [55, 35], to = [30, 5]
  const [lon, lat] = pannedCentre(centre, from, to)
  const after = separationDeg(lon, lat, from[0], from[1])
  const before = separationDeg(centre[0], centre[1], to[0], to[1])
  assert.ok(near(after, before), `${after} vs ${before}`)
})

test('a zero-length drag leaves the centre untouched', () => {
  assert.deepEqual(pannedCentre([40, 20], [55, 35], [55, 35]), [40, 20])
})

test('clampLook keeps a look direction inside the limits unchanged', () => {
  assert.deepEqual(clampLook(100, 120, 45), { az: 120, alt: 45 })
})

test('clampLook stops the altitude at the limit but keeps the azimuth', () => {
  assert.deepEqual(clampLook(100, 101, 89.7), { az: 101, alt: LOOK_ALT_LIMIT })
})

test('clampLook treats an azimuth flip near the zenith as a pole crossing and holds the azimuth', () => {
  assert.deepEqual(clampLook(100, 280, 88.5), { az: 100, alt: LOOK_ALT_LIMIT })
})

test('clampLook accepts a large azimuth swing away from the pole', () => {
  assert.deepEqual(clampLook(100, 280, 30), { az: 280, alt: 30 })
})

test('clampLook mirrors the limit at the nadir', () => {
  assert.deepEqual(clampLook(100, 280, -88.5), { az: 100, alt: -LOOK_ALT_LIMIT })
})
