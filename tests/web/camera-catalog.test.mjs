import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  parseCatalog, searchCameras, matchInstrume, nearestMode,
} from '../../src/lib/cameraCatalog.ts'

const cameras = parseCatalog(JSON.parse(readFileSync('public/catalogs/cameras.json', 'utf8')))

test('catalog holds the 250 source modes under unique ids', () => {
  assert.equal(cameras.flatMap((c) => c.modes).length, 250)
  assert.equal(new Set(cameras.map((c) => c.id)).size, cameras.length)
  for (const c of cameras) assert.ok(c.modes.length >= 1 && c.pixelSize > 0 && c.qe > 0)
})

test('ASI2600MC Pro has both gain modes', () => {
  const c = cameras.find((x) => x.model === 'ZWO ASI2600MC Pro')
  assert.deepEqual(c.modes.map((m) => m.gain), [0, 100])
  assert.equal(c.mono, false); assert.equal(c.maxCooling, 35)
})

test('matchInstrume ignores case, spacing, hyphens and the vendor prefix', () => {
  for (const s of ['ZWO ASI2600MC Pro', 'ASI2600MC Pro', 'zwo asi2600mc-pro', 'ZWO CCD ASI2600MC Pro'])
    assert.equal(matchInstrume(cameras, s)?.model, 'ZWO ASI2600MC Pro')
  assert.equal(matchInstrume(cameras, 'ASI2600MM Pro')?.model, 'ZWO ASI2600MM Pro')
  assert.equal(matchInstrume(cameras, 'Some Unknown Cam'), null)
  assert.equal(matchInstrume(cameras, ''), null)
})

// A vendor name glued directly to the model (no separating space, e.g.
// QHY's "QHY600M") must not strip down to a bare, generic alias ("600m")
// that then false-matches as a substring of an unrelated header.
test('matchInstrume never strips a vendor name that is not a separate word', () => {
  // None of these are a QHY camera, but without a required separator after
  // the vendor name, "QHY600M" / "QHY183M" / "QHY533M" strip down to a bare
  // "600m" / "183m" / "533m" that then false-matches as a substring here.
  assert.equal(matchInstrume(cameras, 'ZWO ASI1600MM Cool'), null)
  assert.equal(matchInstrume(cameras, 'ZWO ASI2600MM Duo'), null)
  assert.equal(matchInstrume(cameras, 'ZWO ASI183MM'), null)
  assert.equal(matchInstrume(cameras, 'ZWO ASI533MM'), null)
})

test('nearestMode picks the closest gain and tolerates a missing one', () => {
  const c = cameras.find((x) => x.model === 'ZWO ASI2600MC Pro')
  assert.equal(nearestMode(c, 120).gain, 100)
  assert.equal(nearestMode(c, 10).gain, 0)
  assert.equal(nearestMode(c, undefined).gain, 100) // default: lowest read noise
})

test('searchCameras matches model and sensor words in any order', () => {
  assert.equal(searchCameras(cameras, '2600 mc')[0].model, 'ZWO ASI2600MC Pro')
  assert.ok(searchCameras(cameras, 'imx571').length >= 2)
  assert.equal(searchCameras(cameras, '').length, cameras.length)
})

test('parseCatalog rejects a malformed file', () => {
  assert.throws(() => parseCatalog({ cameras: [{ id: 'x' }] }))
})
