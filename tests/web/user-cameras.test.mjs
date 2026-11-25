import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCatalog } from '../../src/lib/cameraCatalog.ts'
import { collectUserCameras, restoreState, DEFAULT_STATE } from '../../src/lib/userCameras.ts'

const catalog = parseCatalog(JSON.parse(readFileSync('public/catalogs/cameras.json', 'utf8')))

function light(instrume, extra = {}) {
  const header = instrume === undefined ? undefined : {
    instrume,
    gain: extra.gain ?? null,
    ccdTemp: extra.ccdTemp ?? null,
    filter: extra.filter ?? null,
    raw: extra.raw ?? {},
  }
  return { filename: 'f.fits', path: '/f.fits', sizeBytes: 1, header }
}

function session(date, lights) {
  return {
    date, path: '/s', lights, flats: [], darks: [], biases: [],
    integrationSeconds: 0, totalSizeBytes: 0, calibration: 'none', hasNotes: false, subsDateRange: null,
  }
}

function filterGroup(sessions) {
  return { name: 'L', path: '/f', sessions, otherFiles: [], totalIntegrationSeconds: 0, totalLightFrames: 0, totalSizeBytes: 0, hasNotes: false }
}

function project(name, filters) {
  return { name, path: `/${name}`, filters, totalIntegrationSeconds: 0, totalLightFrames: 0, totalFlatFrames: 0, totalSizeBytes: 0, lastCaptureDate: null, hasNotes: false }
}

test('aggregates subs per camera and sorts by subs descending; the latest session wins the recorded values', () => {
  const proj1 = project('P1', [filterGroup([
    session('2026-01-01', Array.from({ length: 30 }, () => light('ZWO ASI2600MC Pro', { gain: 0, ccdTemp: -5, filter: 'L', raw: { FOCRATIO: 5.6, XPIXSZ: 3.76 } }))),
    session('2026-02-01', Array.from({ length: 20 }, () => light('ZWO ASI2600MC Pro', { gain: 100, ccdTemp: -10, filter: 'Ha', raw: { FOCRATIO: '5.6', XPIXSZ: '3.76' } }))),
  ])])
  const proj2 = project('P2', [filterGroup([
    session('2026-01-15', Array.from({ length: 5 }, () => light('Mystery Cam', { gain: 50, ccdTemp: 10, raw: { FOCALLEN: 400 } }))),
  ])])

  const result = collectUserCameras([proj1, proj2], catalog)
  assert.equal(result.length, 2)

  assert.equal(result[0].subs, 50)
  assert.equal(result[0].camera?.model, 'ZWO ASI2600MC Pro')
  assert.equal(result[0].gain, 100)
  assert.equal(result[0].sensorTemp, -10)
  assert.equal(result[0].filter, 'Ha')
  assert.equal(result[0].focalRatio, 5.6)
  assert.equal(result[0].pixelSize, 3.76)

  assert.equal(result[1].subs, 5)
  assert.equal(result[1].camera, null)
  assert.equal(result[1].focalRatio, null)
  assert.equal(result[1].focalLength, 400)
})

test("a session's values come from the first light that has a header, but all its lights still count", () => {
  const lights = [light(undefined), light('ZWO ASI2600MC Pro', { gain: 0 })]
  const proj = project('P', [filterGroup([session('2026-01-01', lights)])])
  const result = collectUserCameras([proj], catalog)
  assert.equal(result.length, 1)
  assert.equal(result[0].subs, 2)
  assert.equal(result[0].gain, 0)
})

test('sessions with no headered light, or an empty INSTRUME, are skipped without throwing', () => {
  const proj = project('P', [filterGroup([
    session('2026-01-01', [light(undefined), light(undefined)]),
    session('2026-01-02', [light('')]),
  ])])
  assert.doesNotThrow(() => collectUserCameras([proj], catalog))
  assert.deepEqual(collectUserCameras([proj], catalog), [])
})

test('an empty project list gives an empty result', () => {
  assert.deepEqual(collectUserCameras([], catalog), [])
})

test('restoreState falls back to defaults for anything that is not a usable saved object', () => {
  for (const bad of [undefined, null, 'x', {}]) {
    assert.deepEqual(restoreState(bad, catalog), DEFAULT_STATE)
  }
})

test('an unknown cameraId resets the camera but keeps the conditions', () => {
  const saved = {
    cameraId: 'nonexistent-id', modeId: 'whatever',
    bortle: 3, sqm: '19.5', filterId: 'nb3', customFilterPct: '5',
    focalRatio: '4', sensorTemp: '-15', extraNoise: 0.1, skyMode: 'sqm',
  }
  const state = restoreState(saved, catalog)
  assert.equal(state.cameraId, null)
  assert.equal(state.modeId, null)
  assert.equal(state.bortle, 3)
  assert.equal(state.sqm, '19.5')
  assert.equal(state.filterId, 'nb3')
  assert.equal(state.customFilterPct, '5')
  assert.equal(state.focalRatio, '4')
  assert.equal(state.sensorTemp, '-15')
  assert.equal(state.extraNoise, 0.1)
  assert.equal(state.skyMode, 'sqm')
})

test('a modeId not on the saved camera is dropped, the camera is kept', () => {
  const state = restoreState({ cameraId: 'zwo-asi2600mc-pro', modeId: 'not-a-real-mode' }, catalog)
  assert.equal(state.cameraId, 'zwo-asi2600mc-pro')
  assert.equal(state.modeId, null)
})

test('compare entries with unknown camera or mode ids are dropped, the rest capped at 5', () => {
  const valid = { cameraId: 'zwo-asi2600mc-pro', modeId: 'zwo-asi2600mc-pro-lcg' }
  const saved = {
    compare: [
      valid, valid, valid, valid, valid, valid, valid,
      { cameraId: 'bogus', modeId: 'x' },
      { cameraId: 'zwo-asi2600mc-pro', modeId: 'bogus-mode' },
    ],
  }
  const state = restoreState(saved, catalog)
  assert.equal(state.compare.length, 5)
  assert.ok(state.compare.every((e) => e.cameraId === 'zwo-asi2600mc-pro' && e.modeId === 'zwo-asi2600mc-pro-lcg'))
})

test('a non-number extraNoise falls back to the default', () => {
  const state = restoreState({ extraNoise: 'abc' }, catalog)
  assert.equal(state.extraNoise, 0.05)
})

test('overridesByCamera is kept per camera id, malformed entries dropped', () => {
  const saved = {
    overridesByCamera: {
      custom: { pixelSize: 3.76, qe: 60 },
      'zwo-asi2600mc-pro': { readNoise: 1.2 },
      bogus: 'not an object',
    },
  }
  const state = restoreState(saved, catalog)
  assert.deepEqual(state.overridesByCamera, {
    custom: { pixelSize: 3.76, qe: 60 },
    'zwo-asi2600mc-pro': { readNoise: 1.2 },
  })
})

// FITS writers often store floats as float32: -20.1 arrives as -20.1000003814697.
test('recorded header values are rounded to readable precision', () => {
  const proj = project('P', [filterGroup([
    session('2026-01-01', [light('ZWO ASI2600MC Pro', {
      gain: 100, ccdTemp: -20.1000003814697,
      raw: { FOCRATIO: 5.599999904632568, FOCALLEN: '399.9999847', XPIXSZ: '3.7599999904632568' },
    })]),
  ])])
  const [cam] = collectUserCameras([proj], catalog)
  assert.equal(cam.sensorTemp, -20.1)
  assert.equal(cam.focalRatio, 5.6)
  assert.equal(cam.focalLength, 400)
  assert.equal(cam.pixelSize, 3.76)
})
