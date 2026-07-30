import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  circleFrom3, fitShape, pointInPolygon, visiblePolyline,
} from '../../src/lib/altAzView.ts'

test('circleFrom3 recovers a known circle', () => {
  const c = circleFrom3([1, 0], [0, 1], [-1, 0])
  assert.ok(c && Math.abs(c.cx) < 1e-9 && Math.abs(c.cy) < 1e-9 && Math.abs(c.r - 1) < 1e-9)
})

test('circleFrom3 returns null for collinear points', () => {
  assert.equal(circleFrom3([0, 0], [1, 1], [2, 2]), null)
})

test('pointInPolygon: unit square', () => {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]]
  assert.equal(pointInPolygon([0.5, 0.5], sq), true)
  assert.equal(pointInPolygon([1.5, 0.5], sq), false)
})

test('fitShape fits sampled circle points back to that circle', () => {
  const pts = []
  for (let i = 0; i < 12; i++) {
    const th = (i / 12) * 2 * Math.PI
    pts.push([100 + 50 * Math.cos(th), 100 + 50 * Math.sin(th)])
  }
  const s = fitShape(pts, 500, 100, 100)
  assert.equal(s?.kind, 'circle')
  assert.ok(Math.abs(s.cx - 100) < 1e-6 && Math.abs(s.cy - 100) < 1e-6 && Math.abs(s.r - 50) < 1e-6)
})

test('visiblePolyline returns a closed 64-segment loop for a fully visible circle', () => {
  const poly = visiblePolyline({ kind: 'circle', cx: 0, cy: 0, r: 10 }, 0, 0, 100, 100)
  assert.ok(poly)
  assert.equal(poly.closed, true)
  assert.equal(poly.pts.length, 64)
})
