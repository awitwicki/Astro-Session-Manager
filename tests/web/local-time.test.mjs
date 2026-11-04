import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLocalDateTime, formatForDateTimeInput } from '../../src/lib/localTime.ts'

test('parseLocalDateTime reads the wall clock in the site zone', () => {
  assert.equal(parseLocalDateTime('2026-11-04T21:30', 'Asia/Tokyo').toISOString(), '2026-11-04T12:30:00.000Z')
  assert.equal(parseLocalDateTime('2026-07-04T21:30', 'America/New_York').toISOString(), '2026-07-05T01:30:00.000Z')
})
test('parseLocalDateTime rejects garbage', () => {
  assert.equal(parseLocalDateTime('', 'UTC'), null)
  assert.equal(parseLocalDateTime('2026-13-40T99:99', 'UTC'), null)
})
test('formatForDateTimeInput round-trips with parseLocalDateTime', () => {
  const d = new Date('2026-11-04T12:30:00Z')
  const s = formatForDateTimeInput(d, 'Asia/Tokyo')
  assert.equal(s, '2026-11-04T21:30')
  assert.equal(parseLocalDateTime(s, 'Asia/Tokyo').getTime(), d.getTime())
})
