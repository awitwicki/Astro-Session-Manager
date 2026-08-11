import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getWmsTimeBucket } from '../../docs/astroweather/js/satellite.js'

test('getWmsTimeBucket floors to the current 15-minute window', () => {
  assert.equal(getWmsTimeBucket(new Date('2026-08-09T07:34:12.000Z')), '2026-08-09T07:30:00.000Z')
  assert.equal(getWmsTimeBucket(new Date('2026-08-09T07:44:59.999Z')), '2026-08-09T07:30:00.000Z')
  assert.equal(getWmsTimeBucket(new Date('2026-08-09T07:45:00.000Z')), '2026-08-09T07:45:00.000Z')
  assert.equal(getWmsTimeBucket(new Date('2026-08-09T00:00:00.000Z')), '2026-08-09T00:00:00.000Z')
})

test('getWmsTimeBucket changes only when a 15-minute boundary is crossed', () => {
  const a = getWmsTimeBucket(new Date('2026-08-09T07:30:00.000Z'))
  const b = getWmsTimeBucket(new Date('2026-08-09T07:37:00.000Z'))
  const c = getWmsTimeBucket(new Date('2026-08-09T07:44:59.000Z'))
  const d = getWmsTimeBucket(new Date('2026-08-09T07:45:01.000Z'))
  assert.equal(a, b)
  assert.equal(b, c)
  assert.notEqual(c, d)
})
