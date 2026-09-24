import { test } from 'node:test'
import assert from 'node:assert/strict'
import { grabbedCentre, LOOK_ALT_LIMIT } from '../../src/lib/skyPan.ts'
import { separationDeg } from '../../src/lib/ephemeris.ts'

const D = Math.PI / 180

// Level stereographic view about `centre`, longitude growing to the left and
// y down, in units of the projection scale — the forward of grabbedCentre.
function offsetOf([lon, lat], [lon0, lat0]) {
  const dl = (lon - lon0) * D, p = lat * D, p0 = lat0 * D
  const k = 1 / (1 + Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl))
  const east = k * Math.cos(p) * Math.sin(dl)
  const north = k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl))
  return [-east, -north]
}

const sameCentre = (a, b, tol = 1e-7) => separationDeg(a[0], a[1], b[0], b[1]) < tol

test('grabbedCentre inverts the level projection: the grabbed point lands where it was drawn', () => {
  const cases = [
    [[40, 20], [55, 35]],
    [[0, 70], [30, 60]],      // near the pole, where step-and-relevel slipped
    [[200, -45], [170, -80]], // across the far pole
    [[10, 88], [190, 80]],    // centre at the pole limit, point over the pole
    [[123, 0], [123, 0]],     // point at the centre
    [[300, 5], [20, -30]],    // far off-centre
  ]
  for (const [centre, grab] of cases) {
    const [dx, dy] = offsetOf(grab, centre)
    const got = grabbedCentre(grab, dx, dy, [centre[0] + 1, centre[1] - 0.5])
    assert.ok(sameCentre(got, centre), `centre ${centre} grab ${grab}: got ${got}`)
  }
})

test('grabbedCentre: dragging the centre point 10° to the right turns the view 10° east', () => {
  // Right on screen is west on the sky, so the point now west of the new
  // centre means the centre moved east.
  const [dx, dy] = offsetOf([0, 0], [10, 0])
  const got = grabbedCentre([0, 0], dx, dy, [0, 0])
  assert.ok(dx > 0 && Math.abs(dy) < 1e-12)
  assert.ok(sameCentre(got, [10, 0]), `${got}`)
})

test('grabbedCentre stops the centre at the pole limit instead of crossing it', () => {
  // Grab a point 10° below the pole and drag it far down: the centre would
  // have to go past the pole to keep it under the cursor.
  const got = grabbedCentre([0, 80], 0, 5, [0, 60])
  assert.ok(Math.abs(got[1]) <= LOOK_ALT_LIMIT + 1e-9, `${got}`)
  assert.ok(got[1] > 0, `${got}`)
})

test('grabbedCentre picks the solution continuous with the previous centre', () => {
  const centre = [30, 40], grab = [50, 50]
  const [dx, dy] = offsetOf(grab, centre)
  const got = grabbedCentre(grab, dx, dy, centre)
  assert.ok(sameCentre(got, centre), `${got}`)
})
