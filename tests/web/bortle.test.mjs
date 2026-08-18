import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BORTLE_ROWS, factorsAtBortle, factorsAtSqm, nearestBortleForSqm, timeRatio,
} from '../../src/lib/bortle.ts'

test('table covers Bortle 1-8 with descending SQM anchors', () => {
  assert.equal(BORTLE_ROWS.length, 8)
  assert.deepEqual(BORTLE_ROWS.map((r) => r.bortle), [1, 2, 3, 4, 5, 6, 7, 8])
  for (let i = 1; i < BORTLE_ROWS.length; i++) {
    assert.ok(BORTLE_ROWS[i].sqm < BORTLE_ROWS[i - 1].sqm)
  }
})

test('factorsAtBortle returns the table row factors', () => {
  assert.deepEqual(factorsAtBortle(2), { broadband: 1.0, ha: 1.0, oiii: 1.0 })
  assert.deepEqual(factorsAtBortle(5), { broadband: 4.8, ha: 1.2, oiii: 1.8 })
})

test('factorsAtBortle rejects classes outside the table', () => {
  assert.equal(factorsAtBortle(0), null)
  assert.equal(factorsAtBortle(9), null)
  assert.equal(factorsAtBortle(2.5), null)
})

test('timeRatio converts between two skies per channel', () => {
  const b2 = factorsAtBortle(2)
  const b5 = factorsAtBortle(5)
  const up = timeRatio(b2, b5)
  assert.ok(Math.abs(up.broadband - 4.8) < 1e-9)
  assert.ok(Math.abs(up.ha - 1.2) < 1e-9)
  assert.ok(Math.abs(up.oiii - 1.8) < 1e-9)
  const down = timeRatio(b5, b2)
  assert.ok(Math.abs(down.broadband - 1 / 4.8) < 1e-9)
  const same = timeRatio(b5, b5)
  assert.equal(same.broadband, 1)
  assert.equal(same.ha, 1)
  assert.equal(same.oiii, 1)
})

test('factorsAtSqm reproduces table rows at each class anchor', () => {
  for (const row of BORTLE_ROWS) {
    const f = factorsAtSqm(row.sqm)
    assert.ok(Math.abs(f.broadband - row.broadband) < 1e-9, `broadband at B${row.bortle}`)
    assert.ok(Math.abs(f.ha - row.ha) < 1e-9, `ha at B${row.bortle}`)
    assert.ok(Math.abs(f.oiii - row.oiii) < 1e-9, `oiii at B${row.bortle}`)
  }
})

test('factorsAtSqm interpolates log-linearly between anchors', () => {
  const b5 = BORTLE_ROWS.find((r) => r.bortle === 5)
  const b6 = BORTLE_ROWS.find((r) => r.bortle === 6)
  const mid = (b5.sqm + b6.sqm) / 2
  const f = factorsAtSqm(mid)
  assert.ok(Math.abs(f.broadband - Math.sqrt(b5.broadband * b6.broadband)) < 1e-9)
  assert.ok(Math.abs(f.ha - Math.sqrt(b5.ha * b6.ha)) < 1e-9)
  assert.ok(Math.abs(f.oiii - Math.sqrt(b5.oiii * b6.oiii)) < 1e-9)
})

test('factorsAtSqm stays between neighbouring class factors', () => {
  const f = factorsAtSqm(20.5) // between Bortle 4 (21.09) and Bortle 5 (20.00)
  assert.ok(f.broadband > 2.3 && f.broadband < 4.8)
  assert.ok(f.ha > 1.1 && f.ha < 1.2)
  assert.ok(f.oiii > 1.3 && f.oiii < 1.8)
})

test('factorsAtSqm clamps outside the anchor range', () => {
  const b1 = BORTLE_ROWS[0]
  const b8 = BORTLE_ROWS[BORTLE_ROWS.length - 1]
  assert.deepEqual(factorsAtSqm(23), factorsAtSqm(b1.sqm))
  assert.deepEqual(factorsAtSqm(16), factorsAtSqm(b8.sqm))
})

test('nearestBortleForSqm maps readings to the closest class', () => {
  assert.equal(nearestBortleForSqm(22.3), 1)
  assert.equal(nearestBortleForSqm(21.9), 2)
  assert.equal(nearestBortleForSqm(20.1), 5)
  assert.equal(nearestBortleForSqm(17.5), 8)
})
