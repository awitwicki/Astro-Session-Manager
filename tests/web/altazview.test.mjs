import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  circleFrom3, cutAtInfinity, fillGround, fitShape, longestRunPolyline, pointInPolygon, sideOf, sideProbe, skySideFromPoint,
  visiblePolyline,
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

// Records the path a fill draws, so tests can see which side got filled.
function recordingCtx() {
  const calls = []
  const ctx = {
    fillStyle: '',
    beginPath: () => calls.push(['beginPath']),
    moveTo: (x, y) => calls.push(['moveTo', x, y]),
    lineTo: (x, y) => calls.push(['lineTo', x, y]),
    closePath: () => calls.push(['closePath']),
    rect: (...a) => calls.push(['rect', ...a]),
    fill: (rule) => calls.push(['fill', rule]),
  }
  return { ctx, calls }
}

test('sideOf: +1 is to the right of the direction of travel on a canvas', () => {
  assert.equal(sideOf([0, 0], [10, 0], [2, 2]), 1)  // below a rightward step
  assert.equal(sideOf([0, 0], [10, 0], [2, -2]), -1)
  assert.equal(sideOf([0, 0], [10, 0], [20, 0]), 0)
})

test('sideProbe sits just off the segment nearest the given point, on the asked side', () => {
  const poly = { pts: [[0, 0], [100, 0], [100, 100]], closed: false }
  const below = sideProbe(poly, 40, 30, 1)
  assert.ok(Math.abs(below[0] - 50) < 1e-9 && below[1] > 0 && below[1] <= 0.5, `${below}`)
  const right = sideProbe(poly, 140, 60, -1) // nearest: the downward segment
  assert.ok(right[0] > 100 && Math.abs(right[1] - 50) < 1e-9, `${right}`)
})

// Pulls the traced outline out of a recorded fill.
const tracedLoop = (calls) => calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo').map((c) => [c[1], c[2]])

// Three quarters of a circle of radius 40 round (50, 50), in increasing
// angle: the visible part of a horizon that curls past a half-turn.
const curl = () => {
  const pts = []
  for (let i = 0; i <= 48; i++) {
    const th = Math.PI / 4 + (i / 48) * 1.5 * Math.PI
    pts.push([50 + 40 * Math.cos(th), 50 + 40 * Math.sin(th)])
  }
  return { pts, closed: false }
}

test('skySideFromPoint: closed line, sky inside or outside, either winding', () => {
  // Clockwise on a canvas: the inside is to the right of travel (+1).
  const sq = [[40, 40], [60, 40], [60, 60], [40, 60]]
  assert.equal(skySideFromPoint({ pts: sq, closed: true }, [50, 50], 100, 100), 1)
  assert.equal(skySideFromPoint({ pts: [...sq].reverse(), closed: true }, [50, 50], 100, 100), -1)
  assert.equal(skySideFromPoint({ pts: sq, closed: true }, [90, 50], 100, 100), -1)
})

test('skySideFromPoint: open line, with the sky point near or far beyond the view', () => {
  const line = { pts: [[0, 50], [100, 50]], closed: false }
  assert.equal(skySideFromPoint(line, [50, 60], 100, 100), 1)
  assert.equal(skySideFromPoint(line, [50, 40], 100, 100), -1)
  assert.equal(skySideFromPoint(line, [50, -1e7], 100, 100), -1)
})

test('skySideFromPoint: an arc curled past a half-turn keeps its centre on the inside', () => {
  // Increasing screen angle has the circle's inside on sideOf() = +1.
  assert.equal(skySideFromPoint(curl(), [50, 50], 100, 100), 1)
  assert.equal(skySideFromPoint(curl(), [50, 97], 100, 100), -1)
})

test('fillGround: closed line with the sky inside fills the outside (even-odd rect)', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]]
  const { ctx, calls } = recordingCtx()
  fillGround(ctx, { pts: sq, closed: true }, 1, 100, 100) // clockwise: inside is +1
  assert.ok(calls.some((c) => c[0] === 'rect'))
  assert.deepEqual(calls.at(-1), ['fill', 'evenodd'])
})

test('fillGround: closed line with the sky outside fills just the inside', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]]
  const { ctx, calls } = recordingCtx()
  fillGround(ctx, { pts: sq, closed: true }, -1, 100, 100)
  assert.ok(!calls.some((c) => c[0] === 'rect'))
  assert.deepEqual(calls.at(-1), ['fill', 'evenodd'])
})

test('fillGround: a skyline through the zenith fills the same side from either winding cue', () => {
  // A wedge of open sky whose apex is the zenith itself — the case where a
  // zenith point-in-polygon test is undecidable and the fill used to flip.
  const wedge = { pts: [[50, 0], [0, 100], [100, 100]], closed: true }
  const skySide = sideOf(wedge.pts[0], wedge.pts[1], [50, 70]) // sky = the wedge's inside
  const { ctx, calls } = recordingCtx()
  fillGround(ctx, wedge, skySide, 200, 200)
  assert.ok(calls.some((c) => c[0] === 'rect')) // ground = everything else
})

test('fillGround: open line fills the side away from the sky', () => {
  const line = { pts: [[0, 50], [100, 50]], closed: false }
  // sideOf(+1) of a left-to-right chord is +y (down on a canvas)
  assert.equal(sideOf(line.pts[0], line.pts[1], [50, 60]), 1)
  for (const [skySide, groundBelow] of [[1, false], [-1, true]]) {
    const { ctx, calls } = recordingCtx()
    fillGround(ctx, line, skySide, 100, 100)
    const loop = tracedLoop(calls)
    assert.equal(pointInPolygon([50, 90], loop), groundBelow)
    assert.equal(pointInPolygon([50, 10], loop), !groundBelow)
  }
})

test('fillGround: an arc curled past a half-turn fills outside it, not the chord side', () => {
  const { ctx, calls } = recordingCtx()
  fillGround(ctx, curl(), 1, 100, 100) // sky inside the circle
  const loop = tracedLoop(calls)
  assert.equal(pointInPolygon([50, 50], loop), false) // centre: sky
  assert.equal(pointInPolygon([85, 50], loop), false) // inside, past the chord of the ends
  assert.equal(pointInPolygon([50, 97], loop), true)  // just outside the arc: ground
  assert.equal(pointInPolygon([2, 50], loop), true)
})

// Stereographic projection centred on RA/Dec (0, 0), 100 px per unit, like
// d3-celestial's: the antipode (180, 0) goes to infinity.
const stereo = ([lon, lat]) => {
  const d = Math.PI / 180, cl = Math.cos(lat * d)
  const k = 2 / (1 + cl * Math.cos(lon * d))
  return [500 + 100 * k * cl * Math.sin(lon * d), 500 - 100 * k * Math.sin(lat * d)]
}
// Small circle of radius r° about (ra0, 0) on the equator, sampled every 2°
// starting at position angle t0.
const loopAbout = (ra0, r, t0 = 0) => {
  const d = Math.PI / 180, pts = []
  for (let t = t0; t < 360 + t0; t += 2) {
    const x = Math.cos(r * d), y = Math.sin(r * d) * Math.cos(t * d), z = Math.sin(r * d) * Math.sin(t * d)
    const lon = Math.atan2(y, x) / d + ra0
    pts.push([((lon % 360) + 360) % 360, Math.asin(z) / d])
  }
  return pts
}

test('cutAtInfinity leaves a loop that stays clear of the antipode whole', () => {
  const raDec = loopAbout(0, 40)
  const pts = raDec.map(([ra, dec]) => stereo([ra > 180 ? ra - 360 : ra, dec]))
  assert.equal(cutAtInfinity(raDec, pts, stereo, 500, 500).filter((p) => !p).length, 0)
})

test('cutAtInfinity opens a loop where it runs out through the antipode between samples', () => {
  // Runs through (180, 0) midway between two samples, which land at opposite
  // ends of the (straight) image, so their chord cuts right across the view.
  const raDec = loopAbout(149, 31, 1)
  const pts = raDec.map(([ra, dec]) => stereo([ra > 180 ? ra - 360 : ra, dec]))
  const cut = cutAtInfinity(raDec, pts, stereo, 500, 500)
  assert.ok(cut.some((p) => !p))
  const run = longestRunPolyline(cut)
  assert.equal(run.closed, false)
  // No segment of what is left is the long jump across the view.
  for (let i = 1; i < run.pts.length; i++) {
    const [a, b] = [run.pts[i - 1], run.pts[i]]
    const ends = Math.min(Math.hypot(a[0] - 500, a[1] - 500), Math.hypot(b[0] - 500, b[1] - 500))
    assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) < 2 * ends + 50, `${a} -> ${b}`)
  }
})
