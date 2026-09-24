import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMasterFlat, matchMasters } from '../../src/lib/calibration.ts'

const master = (o) => ({
  filename: 'm.xisf', path: '/m/m.xisf', sizeBytes: 1, format: 'xisf',
  exposureTime: 0, ccdTemp: null, binning: 1, resolution: null, camera: '', tempSource: 'filename', ...o,
})
const header = (o) => ({ simple: true, bitpix: 16, naxis: 2, naxis1: 6248, naxis2: 4176, bscale: 1, bzero: 0, raw: {}, ...o })
const lib = (darks, biases = []) => ({ darks, biases, otherFiles: [], rootPath: '/m' })

test('isMasterFlat is case-insensitive prefix match', () => {
  assert.equal(isMasterFlat('masterFlat_Ha.xisf'), true)
  assert.equal(isMasterFlat('MASTERFLAT.fits'), true)
  assert.equal(isMasterFlat('flat_001.fits'), false)
  assert.equal(isMasterFlat('my_masterflat.fits'), false)
})

test('matchMasters picks darks by exposure, temperature, resolution; closest temp first', () => {
  const far = master({ filename: 'far', exposureTime: 300, ccdTemp: -8, resolution: '6248x4176' })
  const near = master({ filename: 'near', exposureTime: 300.2, ccdTemp: -10.5, resolution: '6248x4176' })
  const wrongExp = master({ filename: 'exp', exposureTime: 180, ccdTemp: -10, resolution: '6248x4176' })
  const wrongRes = master({ filename: 'res', exposureTime: 300, ccdTemp: -10, resolution: '3000x2000' })
  const r = matchMasters(header({ exptime: 300, ccdTemp: -10 }), lib([far, wrongExp, near, wrongRes]), 2)
  assert.deepEqual(r.darks.map((d) => d.filename), ['near', 'far'])
})

test('matchMasters matches bias by temperature only, closest first', () => {
  const b1 = master({ filename: 'b1', ccdTemp: -5 })
  const b2 = master({ filename: 'b2', ccdTemp: -11 })
  const b3 = master({ filename: 'b3', ccdTemp: -20 })
  const r = matchMasters(header({ exptime: 300, ccdTemp: -10 }), lib([], [b1, b2, b3]), 2)
  assert.deepEqual(r.biases.map((b) => b.filename), ['b2'])
})

test('matchMasters returns null without header, library, exposure or temperature', () => {
  assert.equal(matchMasters(undefined, lib([]), 2), null)
  assert.equal(matchMasters(header({ exptime: 300, ccdTemp: -10 }), null, 2), null)
  assert.equal(matchMasters(header({ ccdTemp: -10 }), lib([]), 2), null)
  assert.equal(matchMasters(header({ exptime: 300 }), lib([]), 2), null)
})
