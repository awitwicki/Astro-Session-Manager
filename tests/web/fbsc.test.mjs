import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  analyze, bandpass, buildRings, shiftFactor, opticsFromScope, effectiveAt,
  sweepFocalRatio, baaderCategory, lineColor,
} from '../../src/lib/fbsc.ts'
import { bandChart, apertureView, sweepChart, transmissionColor } from '../../src/lib/fbscCharts.ts'
import { MODULES, transpile, outputPath } from '../../scripts/sync-filtercalc.mjs'

const HA = 656.3
const deg = (rad) => (rad * 180) / Math.PI
const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected} ± ${tol}, got ${actual}`)

// Band shapes read off the parallel-beam curves in Baader's figures.
const nb65 = { centerNm: HA, fwhmNm: 6.5, flatTopNm: 4, peak: 0.94, nEff: 2 }
const unb35 = { centerNm: 656.4, fwhmNm: 3.5, flatTopNm: 2, peak: 0.94, nEff: 2 }

test('band shape: flat top, half height at FWHM/2, symmetric', () => {
  assert.equal(bandpass(HA, HA, nb65), 0.94)
  assert.equal(bandpass(HA + 1.99, HA, nb65), 0.94)
  near(bandpass(HA + 3.25, HA, nb65), 0.47, 1e-9)
  near(bandpass(HA - 3.25, HA, nb65), 0.47, 1e-9)
  assert.ok(bandpass(HA + 8, HA, nb65) < 0.001)
})

test('tilt formula: no shift head-on, blue shift grows with the angle', () => {
  assert.equal(shiftFactor(0, 2), 1)
  // 10° at n_eff 2: sqrt(1 - (sin10°/2)^2)
  near(shiftFactor((10 * Math.PI) / 180, 2), 0.996224, 1e-6)
  assert.ok(shiftFactor(0.2, 2) < shiftFactor(0.1, 2))
  // A higher index shifts less.
  assert.ok(shiftFactor(0.2, 2.2) > shiftFactor(0.2, 1.8))
})

test('rings cover the clear aperture and weigh by area', () => {
  const rings = buildRings({ fRatio: 4, obstruction: 0.3 }, 2, 12)
  assert.equal(rings.length, 12)
  near(rings[0].rhoIn, 0.3, 1e-12)
  near(rings[11].rhoOut, 1, 1e-12)
  near(rings.reduce((s, r) => s + r.weight, 0), 1, 1e-12)
  for (let i = 1; i < rings.length; i++) assert.ok(rings[i].weight > rings[i - 1].weight)
})

test('ray angles match the legends of Baader figures 2 and 4', () => {
  // f/4, no obstruction: edge ray 7.13°.
  near(deg(analyze(nb65, { fRatio: 4, obstruction: 0 }, HA).thetaMaxRad), 7.13, 0.01)
  // f/2.3, 50 % obstruction, 12 rings: mid angles run 6.46° … 12.02°.
  const rings = buildRings({ fRatio: 2.3, obstruction: 0.5 }, 2, 12)
  near(deg(rings[0].angleRad), 6.46, 0.01)
  near(deg(rings[11].angleRad), 12.02, 0.01)
})

test('slow telescope: nothing is lost', () => {
  const r = analyze(nb65, { fRatio: 7, obstruction: 0 }, HA)
  near(r.atTarget, 0.94, 1e-6)
  assert.equal(r.parallelAtTarget, 0.94)
  assert.ok(r.shiftMaxNm < 0.5)
})

test('fast telescopes reproduce the losses Baader reports', () => {
  // 6.5 nm at f/4: "no influence on the maximum transmission at Hα".
  near(analyze(nb65, { fRatio: 4, obstruction: 0 }, HA).atTarget, 0.94, 0.005)
  // 3.5 nm at f/2.3: "approx. 50 %"; with a 50 % obstruction "approx. 30 %".
  near(analyze(unb35, { fRatio: 2.3, obstruction: 0 }, HA).atTarget, 0.5, 0.06)
  near(analyze(unb35, { fRatio: 2.3, obstruction: 0.5 }, HA).atTarget, 0.3, 0.06)
})

test('effective band: shifted blue, wider, lower; an obstruction narrows it again', () => {
  const open = analyze(unb35, { fRatio: 2.3, obstruction: 0 }, HA)
  assert.ok(open.peakNm < unb35.centerNm - 1)
  assert.ok(open.effFwhmNm > unb35.fwhmNm)
  assert.ok(open.peakT < unb35.peak)
  assert.ok(open.shiftMinNm === 0 && open.meanShiftNm > 0 && open.meanShiftNm < open.shiftMaxNm)
  // Edge ray at f/2.3: atan(1/4.6) = 12.26°, 3.71 nm at n_eff 2.
  near(open.shiftMaxNm, 3.71, 0.01)

  const obstructed = analyze(unb35, { fRatio: 2.3, obstruction: 0.5 }, HA)
  assert.ok(obstructed.peakNm < open.peakNm)
  assert.ok(obstructed.effFwhmNm < open.effFwhmNm)
  assert.ok(obstructed.peakT > open.peakT)
  assert.ok(obstructed.shiftMinNm > 0)
})

test('best centre is red of the line and recovers the light', () => {
  const optics = { fRatio: 2.3, obstruction: 0.5 }
  const r = analyze(unb35, optics, HA)
  assert.ok(r.bestCenterNm > HA + 1.5 && r.bestCenterNm < HA + 3.5)
  assert.ok(r.bestAtTarget > 0.85)
  const shifted = analyze({ ...unb35, centerNm: r.bestCenterNm }, optics, HA)
  near(shifted.atTarget, r.bestAtTarget, 1e-3)
  // In a slow beam the best centre is the line itself.
  near(analyze(nb65, { fRatio: 8, obstruction: 0 }, HA).bestCenterNm, HA, 0.6)
})

test('invalid input gives null', () => {
  const ok = { fRatio: 4, obstruction: 0.3 }
  assert.equal(analyze({ ...nb65, flatTopNm: 7 }, ok, HA), null)
  assert.equal(analyze({ ...nb65, peak: 1.2 }, ok, HA), null)
  assert.equal(analyze({ ...nb65, nEff: 0.5 }, ok, HA), null)
  assert.equal(analyze(nb65, { fRatio: 0, obstruction: 0 }, HA), null)
  assert.equal(analyze(nb65, { fRatio: 4, obstruction: 1 }, HA), null)
  assert.equal(analyze(nb65, ok, NaN), null)
})

test('aperture and focal length reduce to focal ratio and obstruction share', () => {
  assert.deepEqual(opticsFromScope(200, 800, 70), { fRatio: 4, obstruction: 0.35 })
  assert.equal(opticsFromScope(0, 800, 0), null)
  // Only the ratios matter: a scaled telescope gives the same answer.
  const a = analyze(unb35, opticsFromScope(203, 400, 93), HA)
  const b = analyze(unb35, opticsFromScope(406, 800, 186), HA)
  near(a.atTarget, b.atTarget, 1e-12)
})

test('focal-ratio sweep rises towards slow telescopes', () => {
  const pts = sweepFocalRatio(unb35, 0, HA, 1.6, 7, 30)
  assert.equal(pts.length, 30)
  assert.equal(pts[0].fRatio, 1.6)
  near(pts[29].fRatio, 7, 1e-12)
  assert.ok(pts[0].t < 0.3 && pts[29].t > 0.93)
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].t >= pts[i - 1].t - 1e-9)
})

test('Baader line-up by focal ratio (tables 1 and 2)', () => {
  assert.equal(baaderCategory(6.5, 5).name, 'Narrowband')
  assert.equal(baaderCategory(6.5, 3.4).name, 'Highspeed f/2')
  assert.equal(baaderCategory(3.5, 4).name, 'Ultra-Narrowband')
  assert.equal(baaderCategory(4, 3.4).name, 'Ultra-Highspeed f/3')
  assert.equal(baaderCategory(4, 2.3).name, 'Ultra-Highspeed f/3')
  assert.equal(baaderCategory(3.5, 2.2).name, 'Ultra-Highspeed f/2')
})

test('line colours: Hα red, OIII green-cyan', () => {
  assert.equal(lineColor(656.3), 'rgb(255, 64, 64)')
  const [r, g] = lineColor(500.7).match(/\d+/g).map(Number)
  assert.ok(g === 255 && r === 64)
})

test('chart models stay inside their boxes and agree with the numbers', () => {
  const optics = { fRatio: 2.3, obstruction: 0.5 }
  const r = analyze(unb35, optics, HA)

  const band = bandChart(unb35, r, HA)
  assert.equal(band.contributions.length, 7)
  assert.ok(band.targetX > band.box.left && band.targetX < band.box.right)
  assert.ok(band.xTicks.length >= 4 && band.xTicks.length <= 12)
  for (const t of band.xTicks) assert.ok(t.pos >= band.box.left - 0.01 && t.pos <= band.box.right + 0.01)
  assert.deepEqual(band.yTicks.map((t) => t.label), ['0', '20', '40', '60', '80', '100'])
  assert.match(band.effective, /^M[\d.]+,[\d.]+( L[\d.]+,[\d.]+)+$/)

  const ap = apertureView(unb35, r, HA)
  assert.equal(ap.rings.length, 24)
  near(ap.obstructionR, ap.outerR / 2, 1e-9)
  // Zones weighted by area give back the headline number.
  const area = (z) => z.r * (z.width - 0.6)
  const total = ap.rings.reduce((s, z) => s + area(z) * z.t, 0) / ap.rings.reduce((s, z) => s + area(z), 0)
  near(total, r.atTarget, 1e-9)
  // Inner zones (less tilt) pass more of the line than the edge.
  assert.ok(ap.rings[0].t > ap.rings[23].t)

  const sweep = sweepChart(unb35, optics, HA, r.atTarget)
  assert.ok(sweep.marker.x > sweep.box.left && sweep.marker.x < sweep.box.right)
  near(sweep.marker.y, sweep.box.bottom - r.atTarget * (sweep.box.bottom - sweep.box.top), 1e-9)
  // A very slow telescope stretches the axis instead of leaving the plot.
  const slow = sweepChart(unb35, { fRatio: 12, obstruction: 0 }, HA, 0.94)
  assert.ok(slow.marker.x < slow.box.right)
})

test('transmission colours run red to green', () => {
  assert.equal(transmissionColor(0), 'rgb(196, 64, 64)')
  assert.equal(transmissionColor(0.5), 'rgb(217, 164, 65)')
  assert.equal(transmissionColor(1), 'rgb(45, 138, 78)')
  assert.equal(transmissionColor(7), 'rgb(45, 138, 78)')
})

test('website copies of the modules are in sync (yarn sync:filtercalc)', async () => {
  for (const name of MODULES) {
    assert.equal(readFileSync(outputPath(name), 'utf8'), transpile(name), `${name}.js is stale`)
  }
  const web = await import('../../docs/filtercalc/js/fbscCharts.js')
  const webMath = await import('../../docs/filtercalc/js/fbsc.js')
  const optics = { fRatio: 2, obstruction: 0.46 }
  const r = webMath.analyze(unb35, optics, HA)
  assert.deepEqual(r, analyze(unb35, optics, HA))
  assert.deepEqual(web.bandChart(unb35, r, HA), bandChart(unb35, r, HA))
  near(effectiveAt(HA, unb35.centerNm, unb35, r.rings), r.atTarget, 1e-12)
})
