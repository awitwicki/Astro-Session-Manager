import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tzOffsetHours, detectTimeZone, listTimeZones } from '../../docs/astroweather/js/daylight.js'

test('UTC offset is zero', () => {
  assert.equal(tzOffsetHours('UTC', new Date('2026-01-15T12:00:00Z')), 0)
})

test('Berlin observes DST', () => {
  assert.equal(tzOffsetHours('Europe/Berlin', new Date('2026-01-15T12:00:00Z')), 1)
  assert.equal(tzOffsetHours('Europe/Berlin', new Date('2026-07-15T12:00:00Z')), 2)
})

test('unknown zone falls back without throwing', () => {
  assert.equal(typeof tzOffsetHours('Not/AZone', new Date('2026-01-15T12:00:00Z')), 'number')
})

test('zone list and detection are non-empty', () => {
  assert.ok(listTimeZones().length > 0)
  assert.ok(detectTimeZone().length > 0)
})
