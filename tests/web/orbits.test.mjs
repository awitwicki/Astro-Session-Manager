import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  solveKepler, trueAnomalyAt, geocentricEquatorial, asteroidMagnitude, cometMagnitude, jdFromDate,
} from '../../src/lib/orbits.ts'

function near(a, b, tol, wrap = false) {
  let d = a - b
  if (wrap) d = ((d + 540) % 360) - 180
  assert.ok(Math.abs(d) < tol, `${a} vs ${b} (tol ${tol}, off ${d})`)
}

// MPC elements, packed epoch K25BL = JD 2461000.5 (TT ≈ UTC here).
const CERES = { epochJd: 2461000.5, q: 2.7656157 * (1 - 0.0795763), e: 0.0795763, i: 10.58789, node: 80.24963, peri: 73.29974, meanAnomalyDeg: 231.53975, H: 3.35, G: 0.15 }
const VESTA = { epochJd: 2461000.5, q: 2.3615413 * (1 - 0.0901676), e: 0.0901676, i: 7.14406, node: 103.70232, peri: 151.53712, meanAnomalyDeg: 26.80968, H: 3.25, G: 0.15 }
// C/2023 A3: T = 2024 Sep 27.8396 TT → JD 2460581.3396
const A3 = { epochJd: 2460581.3396, q: 0.391298, e: 1.000182, i: 139.0983, node: 21.6807, peri: 308.5876, H: 6.5, G: 3.2 }
const D = new Date('2026-11-04T00:00:00Z')   // JPL Horizons, geocentric astrometric ICRF

test('jdFromDate', () => { near(jdFromDate(new Date('2000-01-01T12:00:00Z')), 2451545.0, 1e-9) })

test('Ceres', () => {
  const p = geocentricEquatorial(CERES, D)
  near(p.ra, 114.73181, 2 / 60, true); near(p.dec, 24.13520, 2 / 60)
  near(p.rAu, 2.64786, 0.002); near(p.deltaAu, 2.15726, 0.002)
})

test('Vesta', () => {
  const p = geocentricEquatorial(VESTA, D)
  near(p.ra, 17.69842, 2 / 60, true); near(p.dec, -4.54153, 2 / 60)
})

test('C/2023 A3 (near-parabolic)', () => {
  const p = geocentricEquatorial(A3, D)
  near(p.ra, 267.60456, 2 / 60, true); near(p.dec, 13.43176, 2 / 60); near(p.rAu, 8.84913, 0.01)
})

test('magnitudes', () => {
  const c = geocentricEquatorial(CERES, D); near(asteroidMagnitude(3.35, 0.15, c.rAu, c.deltaAu, c.phaseDeg), 8.19, 0.3)
  const a = geocentricEquatorial(A3, D); near(cometMagnitude(6.5, 3.2, a.rAu, a.deltaAu), 18.97, 0.3)
})

test('solveKepler round-trips', () => {
  for (const e of [0, 0.5, 0.99]) for (const M of [0.1, 2, 5]) {
    const E = solveKepler(e, M); near(E - e * Math.sin(E), M, 1e-10)
  }
})

test('trueAnomalyAt is finite and continuous across e = 1', () => {
  for (const e of [0.9999, 1, 1.0001, 1.5]) {
    const { nu, r } = trueAnomalyAt({ ...A3, e }, 2460581.3396 + 30)
    assert.ok(Number.isFinite(nu) && Number.isFinite(r) && r > A3.q, `e=${e}: nu=${nu} r=${r}`)
  }
})
