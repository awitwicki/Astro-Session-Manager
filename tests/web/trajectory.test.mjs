import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trajectoryPathJ2000 } from '../../src/lib/trajectory.ts'
import { altAzAt } from '../../src/lib/ephemeris.ts'

const LAT = 50, LON = 20
const T0 = new Date('2026-01-15T00:00:00Z')

test('has 145 samples over 24h at the default 10-minute step', () => {
  const path = trajectoryPathJ2000(10.68, 41.27, T0, T0, LAT, LON)
  assert.equal(path.length, 145)
})

test('the sample at frameTime maps back onto the target itself', () => {
  // At t = frameTime the mapping is the identity (up to refraction, since
  // altAzCurve applies refraction and horizonToEquatorial does not).
  const path = trajectoryPathJ2000(10.68, 41.27, T0, T0, LAT, LON)
  const p0 = path[0]
  assert.ok(Math.abs(p0.ra - 10.68) < 0.35, `ra=${p0.ra}`)
  assert.ok(Math.abs(p0.dec - 41.27) < 0.35, `dec=${p0.dec}`)
})

test('carries the source alt/az/time through', () => {
  const path = trajectoryPathJ2000(10.68, 41.27, T0, T0, LAT, LON)
  const { alt, az } = altAzAt(10.68, 41.27, T0, LAT, LON)
  assert.ok(Math.abs(path[0].alt - alt) < 1e-9 && Math.abs(path[0].az - az) < 1e-9)
  assert.equal(path[0].time.getTime(), T0.getTime())
})
