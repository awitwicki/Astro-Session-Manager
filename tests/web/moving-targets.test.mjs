import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brightMinorBodies, targetPosition, targetMagnitude, planetPosition } from '../../src/lib/movingTargets.ts'
import { targetFromPlanet } from '../../src/lib/plannerTargets.ts'
import { altAzCurve, altAzCurveOf } from '../../src/lib/ephemeris.ts'
import { trajectoryPathJ2000, trajectoryPathOf } from '../../src/lib/trajectory.ts'

const LAT = 50, LON = 20
const T0 = new Date('2026-01-15T00:00:00Z')

test('fixed target returns its own coordinates', () => {
  const t = { id: 'x', name: 'x', designation: 'x', messier: null, ra: 10, dec: 20, type: 'Gx', mag: null, sizeArcmin: null, constellation: '', addedAt: '' }
  assert.deepEqual(targetPosition(t, new Date()), { ra: 10, dec: 20 })
})

test('Mars on 2026-11-04 is near its J2000 geocentric position', () => {
  const { ra, dec } = planetPosition('Mars', new Date('2026-11-04T00:00:00Z'))
  assert.ok(Math.abs(ra - 142.70) < 0.3 && Math.abs(dec - 16.47) < 0.3, `${ra} ${dec}`)
})

test('Moon on 2026-11-04 is geocentric J2000 (not topocentric)', () => {
  const { ra, dec } = planetPosition('Moon', new Date('2026-11-04T00:00:00Z'))
  assert.ok(Math.abs(ra - 159.588) < 0.05 && Math.abs(dec - 7.483) < 0.05, `${ra} ${dec}`)
})

test('planet target moves with time', () => {
  const t = targetFromPlanet('Mars', new Date('2026-11-04T00:00:00Z'))
  assert.equal(t.id, 'planet-Mars'); assert.equal(t.mover.kind, 'planet')
  const a = targetPosition(t, new Date('2026-11-04T00:00:00Z')), b = targetPosition(t, new Date('2026-12-04T00:00:00Z'))
  assert.ok(Math.abs(a.ra - b.ra) > 1)
})

test('Moon target is typed Moon', () => {
  assert.equal(targetFromPlanet('Moon', T0).type, 'Moon')
  assert.equal(targetFromPlanet('Venus', T0).type, 'Planet')
})

test('altAzCurveOf with a fixed resolver equals altAzCurve', () => {
  assert.deepEqual(
    altAzCurveOf(() => ({ ra: 150, dec: 10 }), T0, LAT, LON),
    altAzCurve(150, 10, T0, LAT, LON))
})

test('trajectoryPathOf with a fixed resolver equals trajectoryPathJ2000', () => {
  assert.deepEqual(
    trajectoryPathOf(() => ({ ra: 10.68, dec: 41.27 }), T0, T0, LAT, LON),
    trajectoryPathJ2000(10.68, 41.27, T0, T0, LAT, LON))
})

test('asteroid target is propagated from its elements (Ceres vs JPL Horizons)', () => {
  // Same MPC fixture as orbits.test.mjs (epoch K25BL = JD 2461000.5).
  const CERES = { epochJd: 2461000.5, q: 2.7656157 * (1 - 0.0795763), e: 0.0795763, i: 10.58789, node: 80.24963, peri: 73.29974, meanAnomalyDeg: 231.53975, H: 3.35, G: 0.15 }
  const t = { id: 'Ceres', name: 'Ceres', designation: 'Ceres', messier: null, ra: 0, dec: 0, type: 'Asteroid', mag: null, sizeArcmin: null, constellation: '', addedAt: '', mover: { kind: 'asteroid', elements: CERES } }
  const { ra, dec } = targetPosition(t, new Date('2026-11-04T00:00:00Z'))
  assert.ok(Math.abs(ra - 114.73181) < 2 / 60 && Math.abs(dec - 24.13520) < 2 / 60, `${ra} ${dec}`)
})

const BASE = { id: 'x', name: 'x', designation: 'x', messier: null, ra: 10, dec: 20, type: 'Gx', mag: 9.5, sizeArcmin: null, constellation: '', addedAt: '' }
const D4 = new Date('2026-11-04T00:00:00Z')

test('targetMagnitude: fixed target returns stored mag', () => {
  assert.equal(targetMagnitude(BASE, D4), 9.5)
})

test('targetMagnitude: Mars magnitude changes with date', () => {
  const t = targetFromPlanet('Mars', D4)
  const a = targetMagnitude(t, D4), b = targetMagnitude(t, new Date('2027-06-01T00:00:00Z'))
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && a !== b, `${a} ${b}`)
})

test('targetMagnitude: C/2023 A3 is about 18.97 on 2026-11-04', () => {
  const elements = { epochJd: 2460581.3396, q: 0.391298, e: 1.000182, i: 139.0983, node: 21.6807, peri: 308.5876, H: 6.5, G: 3.2 }
  const m = targetMagnitude({ ...BASE, mag: 1, mover: { kind: 'comet', elements } }, D4)
  assert.ok(Math.abs(m - 18.97) < 0.3, `${m}`)
})

test('targetMagnitude: non-finite result is null', () => {
  const elements = { epochJd: 2461000.5, q: 2.6, e: 0.08, i: 10.6, node: 80.2, peri: 73.3, meanAnomalyDeg: 231.5, H: NaN, G: 0.15 }
  assert.equal(targetMagnitude({ ...BASE, mover: { kind: 'asteroid', elements } }, D4), null)
})

const CERES_BODY = {
  kind: 'asteroid', designation: '(1) Ceres', name: 'Ceres',
  elements: { epochJd: 2461000.5, q: 2.7656157 * (1 - 0.0795763), e: 0.0795763, i: 10.58789, node: 80.24963, peri: 73.29974, meanAnomalyDeg: 231.53975, H: 3.35, G: 0.15 },
}
const A3_BODY = {
  kind: 'comet', designation: 'C/2023 A3', name: 'Tsuchinshan-ATLAS',
  elements: { epochJd: 2460581.3396, q: 0.391298, e: 1.000182, i: 139.0983, node: 21.6807, peri: 308.5876, H: 6.5, G: 3.2 },
}
const NOV_4 = new Date('2026-11-04T00:00:00Z')

test('brightMinorBodies keeps what is bright enough, with its position and magnitude', () => {
  const [ceres, ...rest] = brightMinorBodies([CERES_BODY], NOV_4, 12)
  assert.equal(rest.length, 0)
  assert.equal(ceres.body, CERES_BODY)
  assert.ok(Math.abs(ceres.ra - 114.73) < 0.05 && Math.abs(ceres.dec - 24.14) < 0.05)
  assert.ok(Math.abs(ceres.mag - 8.19) < 0.3)
  assert.deepEqual(brightMinorBodies([CERES_BODY], NOV_4, 5), [])
})

test('brightMinorBodies uses the comet formula for comets', () => {
  // ≈18.97 with the comet formula; the asteroid H-G formula would give ≈16
  assert.equal(brightMinorBodies([A3_BODY], NOV_4, 18).length, 0)
  assert.equal(brightMinorBodies([A3_BODY], NOV_4, 19.5).length, 1)
})

test('brightMinorBodies drops a non-finite magnitude', () => {
  const bad = { ...CERES_BODY, elements: { ...CERES_BODY.elements, H: NaN } }
  assert.deepEqual(brightMinorBodies([bad], NOV_4, 12), [])
})
