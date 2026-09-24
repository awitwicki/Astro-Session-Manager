import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countNights } from '../../src/lib/projectNights.ts'

const filter = (...dates) => ({ sessions: dates.map((date) => ({ date })) })

test('countNights joins the same date across filters', () => {
  const project = {
    filters: [
      filter('2026-09-01', '2026-09-02'),
      filter('2026-09-02', '2026-09-03'),
      filter('2026-09-01'),
    ],
  }
  assert.equal(countNights(project), 3)
})

test('countNights of a project without sessions is 0', () => {
  assert.equal(countNights({ filters: [] }), 0)
  assert.equal(countNights({ filters: [filter()] }), 0)
})
