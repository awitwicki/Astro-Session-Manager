import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RATE_LADDER, nextRate } from '../../src/hooks/useSimTime.ts'

test('ladder is the Stellarium set, symmetric around (skipped) zero', () => {
  assert.deepEqual(RATE_LADDER, [-3600, -600, -60, -1, 1, 60, 600, 3600])
})

test('nextRate climbs and clamps', () => {
  assert.equal(nextRate(1, 1), 60)
  assert.equal(nextRate(60, 1), 600)
  assert.equal(nextRate(3600, 1), 3600)
  assert.equal(nextRate(-3600, -1), -3600)
})

test('nextRate crosses zero directly between -1 and 1', () => {
  assert.equal(nextRate(1, -1), -1)
  assert.equal(nextRate(-1, 1), 1)
})

test('nextRate from pause or an off-ladder rate snaps to ±1', () => {
  assert.equal(nextRate(0, 1), 1)
  assert.equal(nextRate(0, -1), -1)
  assert.equal(nextRate(42, 1), 1)
})
