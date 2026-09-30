import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractCoordinates, fovToPolygonCoords } from '../../src/lib/skymap.ts'

const close = (got, want, eps) => Math.abs(got - want) < eps
const W = 6248
const H = 4176

// A real ZWO ASIAIR Plus light of M 31, plate-solved on the device: the WCS is
// a CD matrix (no CDELT/CROTA) and the reference pixel sits nowhere near the
// middle of the frame, so CRVAL is 1.5° south of the actual field centre.
const ASIAIR_M31 = {
  CRVAL1: 11.0524147277, CRVAL2: 39.8153422766,
  CRPIX1: 1327.28274536, CRPIX2: 1744.19579061,
  CD1_1: 0.00000658688858078, CD1_2: -0.000803357074261,
  CD2_1: 0.000802798007896, CD2_2: 0.00000676306305458,
  RA: 11.0625, DEC: 41.404446, ROTATOR: 270,
  FOCALLEN: 268, XPIXSZ: 3.76, YPIXSZ: 3.76,
  OBJECT: 'M 31', CREATOR: 'ZWO ASIAIR Plus',
}

test('extractCoordinates: CD-matrix WCS — the tile centre is the middle of the frame, not CRVAL', () => {
  const c = extractCoordinates(ASIAIR_M31, W, H)
  assert.ok(c)
  // Centre pixel (3124.5, 2088.5) pushed through CD and the inverse gnomonic
  // projection from CRVAL — lands on M 31 (10.68°, +41.27°).
  assert.ok(close(c.ra, 10.700, 0.01), `ra ${c.ra}`)
  assert.ok(close(c.dec, 41.260, 0.01), `dec ${c.dec}`)
})

test('extractCoordinates: CD-matrix WCS — field size comes from the matrix', () => {
  const c = extractCoordinates(ASIAIR_M31, W, H)
  assert.ok(close(c.fovWidth, W * 0.000802825, 0.002), `w ${c.fovWidth}`)
  assert.ok(close(c.fovHeight, H * 0.000803385, 0.002), `h ${c.fovHeight}`)
})

test('extractCoordinates: CD-matrix WCS — rotation is the position angle of the vertical axis', () => {
  const c = extractCoordinates(ASIAIR_M31, W, H)
  // atan2(CD1_2, CD2_2) = -89.5° → 90.5° mod 180: the long side runs N–S.
  assert.ok(close(c.rotation, 90.5, 0.1), `rot ${c.rotation}`)
})

test('extractCoordinates: legacy CDELT + CROTA2 follows the FITS standard (Calabretta & Greisen §6.1)', () => {
  const raw = { CRVAL1: 100, CRVAL2: 20, CRPIX1: (W + 1) / 2, CRPIX2: (H + 1) / 2,
    CDELT1: -0.001, CDELT2: 0.001, CROTA2: 30 }
  const c = extractCoordinates(raw, W, H)
  assert.ok(c)
  assert.ok(close(c.ra, 100, 1e-9))
  assert.ok(close(c.dec, 20, 1e-9))
  assert.ok(close(c.fovWidth, W * 0.001, 1e-9))
  assert.ok(close(c.fovHeight, H * 0.001, 1e-9))
  // CD1_2 = -CDELT2 sin ρ, CD2_2 = CDELT2 cos ρ → +j axis at PA -30° → 150 mod 180.
  assert.ok(close(c.rotation, 150, 1e-6), `rot ${c.rotation}`)
})

test('extractCoordinates: PC matrix scaled by CDELT', () => {
  const s = Math.sin(Math.PI / 6), co = Math.cos(Math.PI / 6)
  const raw = { CRVAL1: 100, CRVAL2: 20, CRPIX1: (W + 1) / 2, CRPIX2: (H + 1) / 2,
    CDELT1: -0.001, CDELT2: 0.001, PC1_1: co, PC1_2: -s, PC2_1: s, PC2_2: co }
  const c = extractCoordinates(raw, W, H)
  assert.ok(c)
  // CD1_2 = CDELT1·PC1_2 = +0.0005, CD2_2 = CDELT2·PC2_2 → +j axis at PA 30°.
  assert.ok(close(c.rotation, 30, 1e-6), `rot ${c.rotation}`)
  assert.ok(close(c.fovWidth, W * 0.001, 1e-9))
})

test('extractCoordinates: CRVAL without CRPIX is taken as the centre', () => {
  const raw = { CRVAL1: 100, CRVAL2: 20, CD1_1: -0.001, CD1_2: 0, CD2_1: 0, CD2_2: 0.001 }
  const c = extractCoordinates(raw, W, H)
  assert.ok(close(c.ra, 100, 1e-9) && close(c.dec, 20, 1e-9))
})

test('extractCoordinates: unsolved ASIAIR frame — ROTATOR is the sky angle, negated', () => {
  // Same optics, no plate solve. On the ASIAIR ROTATOR ≈ 360° − PA(vertical axis)
  // (checked against 23 solved frames), so 273° means the vertical axis is at PA 87°.
  const raw = { RA: 85.57083, DEC: -2.441111, ROTATOR: 273, FOCALLEN: 414, XPIXSZ: 3.76, YPIXSZ: 3.76,
    OBJECT: 'IC 434', CREATOR: 'ZWO ASIAIR Plus' }
  const c = extractCoordinates(raw, W, H)
  assert.ok(c)
  assert.ok(close(c.ra, 85.57083, 1e-9) && close(c.dec, -2.441111, 1e-9))
  assert.ok(close(c.rotation, 87, 1e-6), `rot ${c.rotation}`)
  assert.ok(close(c.fovWidth, (W * 3.76) / 414000 * 180 / Math.PI, 1e-6))
})

test('extractCoordinates: ROTATOR from other software is a mechanical angle and is ignored', () => {
  const raw = { RA: 85.57083, DEC: -2.441111, ROTATOR: 273, FOCALLEN: 414, XPIXSZ: 3.76, CREATOR: 'N.I.N.A.' }
  assert.equal(extractCoordinates(raw, W, H).rotation, 0)
})

const target = (rotation) => ({
  projectName: 'p', objectName: 'o', filters: [], totalFrames: 0, totalIntegration: 0,
  coordinates: { ra: 0, dec: 0, fovWidth: 5, fovHeight: 3, rotation },
})
const spans = (poly) => {
  const ras = poly.map((p) => p[0]), decs = poly.map((p) => p[1])
  return [Math.max(...ras) - Math.min(...ras), Math.max(...decs) - Math.min(...decs)]
}

test('fovToPolygonCoords: rotation 0 keeps the width along RA; 90 turns it along Dec', () => {
  const [w0, h0] = spans(fovToPolygonCoords(target(0)))
  assert.ok(close(w0, 5, 0.01) && close(h0, 3, 0.01), `${w0} ${h0}`)
  const [w90, h90] = spans(fovToPolygonCoords(target(90)))
  assert.ok(close(w90, 3, 0.01) && close(h90, 5, 0.01), `${w90} ${h90}`)
})

test('fovToPolygonCoords: rotation is a position angle measured from north through east', () => {
  const poly = fovToPolygonCoords(target(30))
  // Midpoint of the +height edge (corners 2 and 3) seen from the centre.
  const mx = (poly[2][0] + poly[3][0]) / 2
  const my = (poly[2][1] + poly[3][1]) / 2
  const pa = Math.atan2(mx, my) * 180 / Math.PI
  assert.ok(close(pa, 30, 0.1), `pa ${pa}`)
})
