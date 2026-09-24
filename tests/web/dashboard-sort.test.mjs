import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sortProjects,
  nextDashboardSort,
  isDashboardSort,
  parseProjectOpenedMap,
} from '../../src/lib/dashboardSort.ts'
import { formatTimeAgo } from '../../src/lib/formatters.ts'

const p = (name, extra = {}) => ({
  name,
  totalIntegrationSeconds: 0,
  totalSizeBytes: 0,
  totalLightFrames: 0,
  lastCaptureDate: null,
  ...extra,
})

test('sortProjects by opened: most recent first, never-opened last by name', () => {
  const projects = [p('m31'), p('ngc7000'), p('ic1805'), p('m42')]
  const opened = { ngc7000: 100, m42: 300 }
  const desc = sortProjects(projects, { column: 'opened', direction: 'desc' }, opened)
  assert.deepEqual(desc.map((x) => x.name), ['m42', 'ngc7000', 'ic1805', 'm31'])
  const asc = sortProjects(projects, { column: 'opened', direction: 'asc' }, opened)
  assert.deepEqual(asc.map((x) => x.name), ['ngc7000', 'm42', 'ic1805', 'm31'])
})

test('sortProjects by numeric column respects direction', () => {
  const projects = [p('a', { totalLightFrames: 5 }), p('b', { totalLightFrames: 9 })]
  assert.deepEqual(sortProjects(projects, { column: 'lights', direction: 'desc' }, {}).map((x) => x.name), ['b', 'a'])
  assert.deepEqual(sortProjects(projects, { column: 'lights', direction: 'asc' }, {}).map((x) => x.name), ['a', 'b'])
})

test('nextDashboardSort toggles and picks a default direction', () => {
  assert.deepEqual(nextDashboardSort({ column: 'name', direction: 'asc' }, 'name'), { column: 'name', direction: 'desc' })
  assert.deepEqual(nextDashboardSort({ column: 'name', direction: 'asc' }, 'opened'), { column: 'opened', direction: 'desc' })
  assert.deepEqual(nextDashboardSort({ column: 'opened', direction: 'desc' }, 'size'), { column: 'size', direction: 'asc' })
})

test('isDashboardSort / parseProjectOpenedMap validate persisted values', () => {
  assert.equal(isDashboardSort({ column: 'opened', direction: 'desc' }), true)
  assert.equal(isDashboardSort({ column: 'bogus', direction: 'desc' }), false)
  assert.equal(isDashboardSort(null), false)
  assert.deepEqual(parseProjectOpenedMap({ a: 1, b: 'x', c: NaN }), { a: 1 })
  assert.deepEqual(parseProjectOpenedMap([1, 2]), {})
  assert.deepEqual(parseProjectOpenedMap(null), {})
})

test('formatTimeAgo', () => {
  const now = Date.UTC(2026, 8, 24, 12)
  assert.equal(formatTimeAgo(now - 10_000, now), 'just now')
  assert.equal(formatTimeAgo(now - 5 * 60_000, now), '5 min ago')
  assert.equal(formatTimeAgo(now - 3 * 3_600_000, now), '3 h ago')
  assert.equal(formatTimeAgo(now - 2 * 86_400_000, now), '2 d ago')
  assert.match(formatTimeAgo(now - 90 * 86_400_000, now), /2026/)
})
