import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  altAzAt, altAzCurve, altitudeCurve, azimuthTicks, sunAltitudes, riseTransitSet, moonInfo, separationDeg, horizonPathJ2000,
  altitudeCircleJ2000, azimuthLineJ2000, parallacticAngleDeg, zenithEquatorial, horizonToEquatorial, sunInfo,
} from '../../src/lib/ephemeris.ts'

const LAT = 50, LON = 20
const T0 = new Date('2026-01-15T00:00:00Z')

test('Polaris altitude ~= observer latitude', () => {
  const { alt } = altAzAt(37.95, 89.264, T0, LAT, LON)
  assert.ok(Math.abs(alt - LAT) < 1.5, `alt=${alt}`)
})

test('transit altitude ~= 90 - |lat - dec| for dec 0', () => {
  const rts = riseTransitSet(150, 0, T0, LAT, LON)
  assert.equal(rts.kind, 'normal')
  assert.ok(Math.abs(rts.transitAlt - 40) < 1, `transitAlt=${rts.transitAlt}`)
  assert.ok(rts.rise instanceof Date && rts.set instanceof Date)
})

test('circumpolar and never-rises kinds', () => {
  assert.equal(riseTransitSet(150, 85, T0, LAT, LON).kind, 'circumpolar')
  assert.equal(riseTransitSet(150, -85, T0, LAT, LON).kind, 'neverRises')
})

test('altitude curve has 145 samples at 10-minute steps', () => {
  const curve = altitudeCurve(37.95, 89.264, T0, LAT, LON)
  assert.equal(curve.length, 145)
  for (const p of curve) assert.ok(Math.abs(p.alt - LAT) < 1.5)
})

test('sun below -18 deg at midnight UTC in January, up at solar noon', () => {
  const sun = sunAltitudes(T0, LAT, LON)
  assert.ok(sun[0].alt < -18, `midnight alt=${sun[0].alt}`)
  const noonIdx = 64 // ~10:40 UTC = local solar noon at lon 20
  assert.ok(sun[noonIdx].alt > 0, `noon alt=${sun[noonIdx].alt}`)
})

test('separation basics', () => {
  assert.ok(Math.abs(separationDeg(0, 0, 90, 0) - 90) < 1e-9)
  assert.equal(separationDeg(10, 20, 10, 20), 0)
})

test('moon info is sane', () => {
  const m = moonInfo(T0, LAT, LON)
  assert.ok(m.illumination >= 0 && m.illumination <= 1)
  assert.ok(typeof m.phaseName === 'string' && m.phaseName.length > 0)
  assert.ok(m.raDeg >= 0 && m.raDeg < 360)
  assert.ok(Math.abs(m.decDeg) <= 29)
})

test('horizon path points sit at altitude ~0', () => {
  for (const [ra, dec] of horizonPathJ2000(T0, LAT, LON, 30)) {
    const { alt } = altAzAt(ra, dec, T0, LAT, LON)
    assert.ok(Math.abs(alt) < 1.5, `alt=${alt}`) // refraction shifts ~0.5 deg at horizon
  }
})

test('altitudeCircleJ2000 points sit at the requested altitude', () => {
  for (const [ra, dec] of altitudeCircleJ2000(30, T0, LAT, LON, 30)) {
    const { alt } = altAzAt(ra, dec, T0, LAT, LON)
    assert.ok(Math.abs(alt - 30) < 0.05, `alt=${alt}`)
  }
})

test('altitudeCircleJ2000 and horizonPathJ2000 do not repeat the az=0 point at az=360 '
  + '(a coincident first/last point degenerates downstream circle-fitting to a spurious line)', () => {
  const ring = altitudeCircleJ2000(30, T0, LAT, LON, 30)
  assert.equal(ring.length, 12, 'expected exactly 12 points for a 30-degree step (0..330)')
  assert.notDeepEqual(ring[0], ring[ring.length - 1])

  const horizon = horizonPathJ2000(T0, LAT, LON, 30)
  assert.equal(horizon.length, 12)
  assert.notDeepEqual(horizon[0], horizon[horizon.length - 1])
})

test('azimuthLineJ2000 points sit at the requested azimuth (away from the poles, where azimuth is undefined)', () => {
  for (const [ra, dec] of azimuthLineJ2000(90, T0, LAT, LON, 20)) {
    const { alt, az } = altAzAt(ra, dec, T0, LAT, LON)
    if (Math.abs(alt) > 89) continue // azimuth is undefined at the zenith/nadir
    assert.ok(Math.abs(az - 90) < 0.05, `az=${az}`)
  }
})

test('zenithEquatorial round-trips to altitude ~90 via altAzAt', () => {
  const [ra, dec] = zenithEquatorial(T0, LAT, LON)
  const { alt } = altAzAt(ra, dec, T0, LAT, LON)
  assert.ok(Math.abs(alt - 90) < 0.05, `alt=${alt}`)
})

test('parallacticAngleDeg is the position angle of the zenith, north through east', () => {
  // Independent check via vector geometry rather than the same spherical-trig
  // identity: build the local north/east basis at the target in J2000, project
  // the direction to the zenith onto it, and read the bearing off directly.
  const D = Math.PI / 180
  const unit = (ra, dec) => [
    Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D),
  ]
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const norm = (v) => { const m = Math.hypot(...v); return v.map((c) => c / m) }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const scale = (v, s) => v.map((c) => c * s)
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
  ]

  for (const [ra, dec] of [[150, 0], [270.9, -24.4], [10.7, 41.3], [37.9, 89.3]]) {
    const t = unit(ra, dec)
    const z = unit(...zenithEquatorial(T0, LAT, LON))
    const pole = [0, 0, 1]
    // Tangent-plane basis at the target: north toward the pole, east = north x target
    const north = norm(sub(pole, scale(t, dot(pole, t))))
    const east = cross(north, t)
    const toZenith = norm(sub(z, scale(t, dot(z, t))))
    const pa = Math.atan2(dot(toZenith, east), dot(toZenith, north)) / D

    const q = parallacticAngleDeg(ra, dec, T0, LAT, LON)
    const diff = ((q - pa + 540) % 360) - 180
    assert.ok(Math.abs(diff) < 0.01, `ra=${ra} dec=${dec}: q=${q} vs pa=${pa}`)
  }
})

test('parallacticAngleDeg is 0 or 180 at transit, on which side of zenith the object culminates', () => {
  // Cross-checks against the independently-implemented SearchHourAngle-based
  // transit time (riseTransitSet) rather than a hand-picked "H=0" instant.
  const south = riseTransitSet(150, 0, T0, LAT, LON) // dec 0 < lat 50: culminates south of zenith
  const north = riseTransitSet(150, 80, T0, LAT, LON) // dec 80 > lat 50: culminates north of zenith
  assert.ok(Math.abs(parallacticAngleDeg(150, 0, south.transit, LAT, LON)) < 0.5)
  assert.ok(Math.abs(Math.abs(parallacticAngleDeg(150, 80, north.transit, LAT, LON)) - 180) < 0.5)
})

test('azimuthTicks: equatorial target is null below horizon, numeric above', () => {
  const curve = altAzCurve(150, 0, T0, LAT, LON)
  const ticks = azimuthTicks(curve, [0, 6, 12, 18, 24])
  assert.equal(ticks.length, 5)
  // a dec-0 target is up ~12h of the day, so both kinds must appear
  assert.ok(ticks.some((t) => t === null))
  assert.ok(ticks.some((t) => typeof t === 'number'))
})

test('azimuthTicks: circumpolar target has a value at every tick', () => {
  const curve = altAzCurve(37.95, 89.264, T0, LAT, LON)
  for (const t of azimuthTicks(curve, [0, 6, 12, 18, 24])) {
    assert.ok(typeof t === 'number' && t >= 0 && t < 360, `t=${t}`)
  }
})

test('azimuthTicks: never-rising target is null at every tick', () => {
  const curve = altAzCurve(150, -85, T0, LAT, LON)
  for (const t of azimuthTicks(curve, [0, 6, 12, 18, 24])) assert.equal(t, null)
})

test('azimuthTicks: reads the curve sample nearest the tick hour', () => {
  const curve = altAzCurve(37.95, 89.264, T0, LAT, LON)
  // 145 samples over 24h: hour 6 → index 6/24 * 144 = 36
  assert.equal(azimuthTicks(curve, [6])[0], curve[36].az)
})

test('horizonToEquatorial roundtrips through altAzAt', () => {
  const [ra, dec] = horizonToEquatorial(210, 42, T0, LAT, LON)
  const { alt, az } = altAzAt(ra, dec, T0, LAT, LON)
  // altAzAt applies refraction (~1 arcmin at 42 deg); allow 0.2 deg
  assert.ok(Math.abs(alt - 42) < 0.2, `alt=${alt}`)
  assert.ok(Math.abs(az - 210) < 0.2, `az=${az}`)
})

test('horizonToEquatorial at alt 90 matches zenithEquatorial', () => {
  const [ra1, dec1] = horizonToEquatorial(0, 90, T0, LAT, LON)
  const [ra2, dec2] = zenithEquatorial(T0, LAT, LON)
  assert.ok(Math.abs(ra1 - ra2) < 1e-6 && Math.abs(dec1 - dec2) < 1e-6)
})

test('sunInfo is sane: below -18 at winter midnight, dec within obliquity', () => {
  const s = sunInfo(T0, LAT, LON)
  assert.ok(s.alt < -18, `alt=${s.alt}`)
  assert.ok(Math.abs(s.decDeg) < 23.6, `dec=${s.decDeg}`)
  assert.ok(s.raDeg >= 0 && s.raDeg < 360)
})
