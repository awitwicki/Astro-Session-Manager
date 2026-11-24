import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKY_FLUX_K, SUB_LADDER, gloverC, skyRate, darkRate, subExposure,
  sweepByFocalRatio, defaultSensorTemp, formatSub,
} from '../../src/lib/subExposure.ts'
import { subChart } from '../../src/lib/subExposureChart.ts'

const s = { mono: false, pixelSize: 3.76, qe: 80, readNoise: 1.15, fullWell: 15000, bitDepth: 16, darkRef: 0.0005, darkRefTemp: 0, darkDoubling: 6 }
const c = { sqm: 20, focalRatio: 5, filterShare: 1, sensorTemp: -10, extraNoise: 0.05 }
const near = (a, b, rel = 1e-9) => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, `${a} vs ${b}`)

// Independent reference: Robin Glover (SharpCap author), SharpCap forum,
// 20 Apr 2022 (https://forums.sharpcap.co.uk/viewtopic.php?p=29102):
// "I estimate a sky background brightness of 1.75e/pix/s for your setup" for
// an ASI533MC (3.76 micron pixels, 80% QE, no filter) at Bortle 5 (our
// BORTLE_ROWS puts Bortle 5 at SQM 20.0), f/4.8. The physically-derived
// SKY_FLUX_K = 1.0e9 reproduces this within 2% (1.717 vs 1.75 e-/px/s), so
// it ships as derived rather than fitted. See the design doc's Calibration
// section for the derivation and the "in between" discussion.
test('skyRate matches Robin Glover\'s own published estimate for a comparable rig', () => {
  const glover = { mono: false, pixelSize: 3.76, qe: 80, readNoise: 1.5, fullWell: 14000, bitDepth: 14, darkRef: 0.0005, darkRefTemp: 0, darkDoubling: 6 }
  const cond = { sqm: 20.0, focalRatio: 4.8, filterShare: 1, sensorTemp: -10, extraNoise: 0.05 }
  near(skyRate(glover, cond), 1.75, 0.03)
})

test('gloverC', () => { near(gloverC(0.05), 9.756, 1e-3); near(gloverC(0.02), 24.75, 1e-3); near(gloverC(0.10), 4.762, 1e-3) })

test('sky rate follows the formula; colour sees 0.35 of mono', () => {
  near(skyRate(s, c), SKY_FLUX_K * 1e-8 * 3.76 ** 2 / 25 * 0.8 * 0.35)
  near(skyRate({ ...s, mono: true }, c) / skyRate(s, c), 1 / 0.35)
  near(skyRate(s, { ...c, sqm: 17.5 }) / skyRate(s, c), 10)
})

test('dark current doubles every 6 °C', () => { near(darkRate(s, 0), 0.0005); near(darkRate(s, 12), 0.002); near(darkRate(s, -6), 0.00025) })

test('quantisation noise adds to read noise', () => {
  const r = subExposure({ ...s, bitDepth: 12, fullWell: 40960 }, c) // step 10 e-
  near(r.readNoiseEff ** 2, 1.15 ** 2 + 100 / 12)
})

test('minSub = C·RN²/(sky+dark) and scales with N² when dark is negligible', () => {
  const r = subExposure(s, c)
  near(r.minSub, gloverC(0.05) * r.readNoiseEff ** 2 / (r.skyRate + r.darkRate))
  near(subExposure(s, { ...c, focalRatio: 10 }).minSub / r.minSub, 4, 0.01)
})

test('suggested is the next ladder step, capped at 1800 s', () => {
  const r = subExposure(s, c); assert.ok(SUB_LADDER.includes(r.suggested) && r.suggested >= r.minSub)
  const idx = SUB_LADDER.indexOf(r.suggested); if (idx > 0) assert.ok(SUB_LADDER[idx - 1] < r.minSub)
  assert.equal(subExposure(s, { ...c, sqm: 22, focalRatio: 12, filterShare: 0.01 }).suggested, 1800)
})

test('verdicts', () => {
  assert.equal(subExposure(s, c).verdict, 'ok')
  assert.equal(subExposure(s, { ...c, sqm: 22, focalRatio: 12, filterShare: 0.01 }).verdict, 'veryLong')
  assert.equal(subExposure({ ...s, darkRef: 0.1 }, { ...c, sensorTemp: 25, filterShare: 0.01 }).verdict, 'darkLimited')
  assert.equal(subExposure({ ...s, readNoise: 20, fullWell: 800 }, c).verdict, 'clipping')
})

test('bad input gives null, never NaN', () => {
  for (const bad of [{ focalRatio: 0 }, { focalRatio: NaN }, { filterShare: 0 }, { sqm: NaN }, { extraNoise: 0 }])
    assert.equal(subExposure(s, { ...c, ...bad }), null)
  for (const bad of [{ qe: 0 }, { readNoise: 0 }, { pixelSize: -1 }, { fullWell: 0 }, { darkDoubling: 0 }])
    assert.equal(subExposure({ ...s, ...bad }, c), null)
})

test('sweep spans f/2 to f/12', () => {
  const pts = sweepByFocalRatio(s, c); assert.equal(pts.length, 41); assert.equal(pts[0].n, 2); assert.equal(pts.at(-1).n, 12)
  assert.ok(pts.every((p, i) => i === 0 || p.t > pts[i - 1].t))
})

test('defaultSensorTemp', () => {
  assert.equal(defaultSensorTemp({ maxCooling: 35 }), -10); assert.equal(defaultSensorTemp({ maxCooling: 20 }), -5); assert.equal(defaultSensorTemp({ maxCooling: null }), 15)
})

test('formatSub', () => { assert.equal(formatSub(8.2), '8 s'); assert.equal(formatSub(90), '1 min 30 s'); assert.equal(formatSub(9360), '2 h 36 min') })

// ─── Chart geometry (subExposureChart.ts) ──────────────────────────────────

const chartSeriesA = { id: 'a', label: 'A', points: [{ n: 2, t: 20 }, { n: 7, t: 70 }, { n: 12, t: 120 }] }
const chartSeriesB = { id: 'b', label: 'B', points: [{ n: 2, t: 10 }, { n: 7, t: 35 }, { n: 12, t: 60 }] }

test('chart paths are well-formed, with no NaN coordinates', () => {
  const chart = subChart([chartSeriesA, chartSeriesB], 7)
  for (const s of chart.series) {
    assert.ok(s.path.startsWith('M'))
    assert.ok(!s.path.includes('NaN'))
  }
})

test('a longer sub length plots a smaller y (higher on the chart)', () => {
  const chart = subChart([chartSeriesA, chartSeriesB], 7)
  const a = chart.series.find((s) => s.id === 'a')
  const b = chart.series.find((s) => s.id === 'b')
  assert.ok(a.marker.y < b.marker.y, `a.marker.y=${a.marker.y} should be < b.marker.y=${b.marker.y}`)
})

test('the marker sits at the plot\'s horizontal middle when currentN is the domain midpoint', () => {
  const chart = subChart([chartSeriesA], 7)
  const mid = chart.plot.x + chart.plot.w / 2
  near(chart.series[0].marker.x, mid, 1e-6)
})

test('an out-of-range or missing currentN gives no marker', () => {
  for (const currentN of [null, 20]) {
    const chart = subChart([chartSeriesA], currentN)
    assert.equal(chart.series[0].marker, null)
  }
})

test('empty input gives an empty series list without throwing', () => {
  assert.doesNotThrow(() => subChart([], 7))
  const chart = subChart([], 7)
  assert.deepEqual(chart.series, [])
})

test('every tick lies within the plot rectangle', () => {
  const chart = subChart([chartSeriesA, chartSeriesB], 7)
  for (const tick of chart.xTicks) {
    assert.ok(tick.x >= chart.plot.x - 1e-6 && tick.x <= chart.plot.x + chart.plot.w + 1e-6)
  }
  for (const tick of chart.yTicks) {
    assert.ok(tick.y >= chart.plot.y - 1e-6 && tick.y <= chart.plot.y + chart.plot.h + 1e-6)
  }
})
