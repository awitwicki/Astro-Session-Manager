import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRA, formatDec, azToCompass } from '../../src/lib/formatters.ts'
import { isPlannerTargetArray } from '../../src/types/planner.ts'

test('formatRA', () => {
  assert.equal(formatRA(10.6848), '00h 42m 44s')
  assert.equal(formatRA(0), '00h 00m 00s')
  assert.equal(formatRA(359.99999), '00h 00m 00s') // rounds up and wraps
})

test('formatDec', () => {
  assert.equal(formatDec(41.269), `+41° 16' 08"`)
  assert.equal(formatDec(-2.458), `-02° 27' 29"`)
})

test('azToCompass', () => {
  assert.equal(azToCompass(0), 'N')
  assert.equal(azToCompass(359), 'N')
  assert.equal(azToCompass(118), 'SE')
  assert.equal(azToCompass(230), 'SW')
})

test('isPlannerTargetArray', () => {
  const valid = [{
    id: 'NGC 7000', name: 'North America Nebula', designation: 'NGC 7000', messier: null,
    ra: 314.82, dec: 44.53, type: 'Emission Nebula', mag: 4, sizeArcmin: [120, 30],
    constellation: 'Cyg', addedAt: '2026-07-20T00:00:00.000Z',
  }]
  assert.ok(isPlannerTargetArray(valid))
  assert.ok(isPlannerTargetArray([]))
  assert.ok(!isPlannerTargetArray('nope'))
  assert.ok(!isPlannerTargetArray([{ id: 1 }]))
  assert.ok(!isPlannerTargetArray([null]))
})
