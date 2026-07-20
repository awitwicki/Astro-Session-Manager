import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skyTintLevels } from '../../src/lib/skyTint.ts'

const close = (a, b) => Math.abs(a - b) < 1e-9

test('full day above 15 degrees', () => {
  assert.deepEqual(skyTintLevels(20), { day: 1, twilight: 0 })
  assert.deepEqual(skyTintLevels(15), { day: 1, twilight: 0 })
})

test('day ramps 0..15 with complementary twilight', () => {
  const t = skyTintLevels(7.5)
  assert.ok(close(t.day, 0.5) && close(t.twilight, 0.5))
})

test('sunset boundary: no day, full twilight', () => {
  assert.deepEqual(skyTintLevels(0), { day: 0, twilight: 1 })
})

test('twilight fades to zero at -18 (astronomical night)', () => {
  assert.ok(close(skyTintLevels(-9).twilight, 0.5))
  assert.deepEqual(skyTintLevels(-18), { day: 0, twilight: 0 })
  assert.deepEqual(skyTintLevels(-40), { day: 0, twilight: 0 })
})
