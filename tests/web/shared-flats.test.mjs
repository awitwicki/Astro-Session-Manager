import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flatIdentity, identityKey, identityCompatible, nightKeyFor, buildFlatIndex, findSharedFlats, offerableFlats, applySharedFlats } from '../../src/lib/sharedFlats.ts'

const hdr = (o = {}) => ({ simple: true, bitpix: 16, naxis: 2, naxis1: 6248, naxis2: 4176, bscale: 1, bzero: 0, raw: {}, ...o })
const sess = (date, subsDateRange = null) => ({ date, subsDateRange })

test('flatIdentity requires INSTRUME, FILTER and a resolution', () => {
  assert.equal(flatIdentity(null), null)
  assert.equal(flatIdentity(hdr({ filter: 'Ha' })), null)
  assert.equal(flatIdentity(hdr({ instrume: 'ASI2600MM' })), null)
  assert.equal(flatIdentity(hdr({ instrume: 'ASI2600MM', filter: '  ' })), null)
  assert.equal(flatIdentity(hdr({ instrume: 'ASI2600MM', filter: 'Ha', naxis1: 0 })), null)
  const id = flatIdentity(hdr({ instrume: 'ASI2600MM', filter: 'Ha' }))
  assert.equal(id.instrume, 'asi2600mm')
  assert.equal(id.filter, 'ha')
  assert.equal(id.resolution, '6248x4176')
  assert.equal(id.binning, null)
  assert.equal(id.focalLen, null)
})

test('flatIdentity normalises case and whitespace, reads binning', () => {
  const a = flatIdentity(hdr({ instrume: ' ZWO  ASI2600MM ', filter: 'Ha', xbinning: 1, ybinning: 1 }))
  const b = flatIdentity(hdr({ instrume: 'zwo asi2600mm', filter: 'HA', xbinning: 1, ybinning: 1 }))
  assert.equal(identityKey(a), identityKey(b))
  assert.equal(a.binning, '1x1')
})

// Review Focus 3: some capture software writes FOCALLEN/FOCRATIO as strings.
test('flatIdentity reads FOCALLEN and FOCRATIO as numbers or numeric strings', () => {
  const num = flatIdentity(hdr({ instrume: 'C', filter: 'L', raw: { FOCALLEN: 540, FOCRATIO: 5.4 } }))
  assert.equal(num.focalLen, 540)
  assert.equal(num.focRatio, 5.4)
  const str = flatIdentity(hdr({ instrume: 'C', filter: 'L', raw: { FOCALLEN: '540', FOCRATIO: '5.4' } }))
  assert.equal(str.focalLen, 540)
  assert.equal(str.focRatio, 5.4)
  const junk = flatIdentity(hdr({ instrume: 'C', filter: 'L', raw: { FOCALLEN: 'n/a', FOCRATIO: 0 } }))
  assert.equal(junk.focalLen, null)
  assert.equal(junk.focRatio, null)
})

test('identityCompatible: required fields exact, tolerant fields only when both known', () => {
  const base = { instrume: 'c', filter: 'ha', resolution: '100x100', binning: '1x1', focalLen: 540, focRatio: 5.4 }
  assert.equal(identityCompatible(base, { ...base }), true)
  assert.equal(identityCompatible(base, { ...base, filter: 'oiii' }), false)
  assert.equal(identityCompatible(base, { ...base, instrume: 'other' }), false)
  assert.equal(identityCompatible(base, { ...base, resolution: '100x101' }), false)
  assert.equal(identityCompatible(base, { ...base, binning: '2x2' }), false)
  assert.equal(identityCompatible(base, { ...base, binning: null }), true)
  assert.equal(identityCompatible(base, { ...base, focalLen: 539.5 }), true)
  assert.equal(identityCompatible(base, { ...base, focalLen: 430 }), false)
  assert.equal(identityCompatible(base, { ...base, focalLen: null }), true)
  assert.equal(identityCompatible(base, { ...base, focRatio: 4.3 }), false)
})

test('nightKeyFor shifts DATE-OBS back 12 h so dawn flats keep the evening date', () => {
  assert.equal(nightKeyFor(hdr({ dateObs: '2026-09-29T21:14:03' }), sess('Night 1')), '2026-09-29')
  assert.equal(nightKeyFor(hdr({ dateObs: '2026-09-30T05:30:00' }), sess('Night 1')), '2026-09-29')
  assert.equal(nightKeyFor(hdr({ dateObs: '2026-09-29T14:00:00' }), sess('Night 1')), '2026-09-29')
})

// Review Focus 2: a date-named folder already names the night — no second shift.
test('nightKeyFor falls back to a date-named folder, then subsDateRange, then the folder name', () => {
  assert.equal(nightKeyFor(hdr(), sess('2026-09-29')), '2026-09-29')
  assert.equal(nightKeyFor(hdr(), sess('2026-09-29_M31')), '2026-09-29')
  assert.equal(nightKeyFor(hdr(), sess('Night 1', '2026-09-29 — 2026-09-30')), '2026-09-29')
  assert.equal(nightKeyFor(hdr(), sess('Night 1')), 'Night-1')
  assert.equal(nightKeyFor(null, sess('2026-09-29')), '2026-09-29')
})

const RIG = { instrume: 'ASI2600MM', xbinning: 1, ybinning: 1, raw: { FOCALLEN: 540, FOCRATIO: 5.4 } }
const light = (path, dateObs, filter, o = {}) => ({
  filename: path.split('/').pop(), path, sizeBytes: 100,
  header: hdr({ ...RIG, filter, dateObs, naxis1: 100, naxis2: 100, ...o }),
})
const flat = (path, dateObs, filter, o = {}) => light(path, dateObs, filter, o)
const sessionOf = (o) => ({
  date: 'Night 1', path: '/r/P/F/Night 1', lights: [], flats: [], darks: [], biases: [],
  integrationSeconds: 0, totalSizeBytes: 0, calibration: { darksMatched: false, flatsAvailable: false },
  hasNotes: false, subsDateRange: null, ...o,
})
const filterOf = (name, sessions, path = `/r/P/${name}`) => ({
  name, path, sessions, otherFiles: [], totalIntegrationSeconds: 0, totalLightFrames: 0,
  totalSizeBytes: 0, hasNotes: false,
})
const projectOf = (name, filters, path = `/r/${name}`) => ({
  name, path, filters, totalIntegrationSeconds: 0, totalLightFrames: 0, totalFlatFrames: 0,
  totalSizeBytes: 0, lastCaptureDate: null, hasNotes: false,
})

/** Lender: evening lights + dawn flats. Borrower: evening lights, no flats. */
const lender = (name, filterName = 'Ha', flats = [flat(`/r/${name}/${filterName}/n/flats/f1.fits`, '2026-09-30T05:30:00', filterName)]) =>
  projectOf(name, [filterOf(filterName, [sessionOf({
    path: `/r/${name}/${filterName}/n`,
    lights: [light(`/r/${name}/${filterName}/n/lights/l1.fits`, '2026-09-29T21:00:00', filterName)],
    flats,
  })])], `/r/${name}`)

const borrower = (name, filterName = 'Ha', lightOpts = {}) =>
  projectOf(name, [filterOf(filterName, [sessionOf({
    path: `/r/${name}/${filterName}/n`,
    lights: [light(`/r/${name}/${filterName}/n/lights/l1.fits`, '2026-09-29T22:00:00', filterName, lightOpts)],
  })])], `/r/${name}`)

const sharedOf = (projects, projectIdx = 0) =>
  projects[projectIdx].filters[0].sessions[0].calibration.sharedFlats ?? null

test('dawn flats in one project are offered to another project from the same night', () => {
  const out = applySharedFlats([lender('A'), borrower('B')])
  const got = sharedOf(out, 1)
  assert.equal(got.projectName, 'A')
  assert.equal(got.nightDate, '2026-09-29')
  assert.equal(got.isMaster, false)
  assert.deepEqual(got.flats.map((f) => f.filename), ['f1.fits'])
  assert.equal(sharedOf(out, 0), null, 'the lender keeps its own flats')
})

test('mosaic panels in one project share flats across differently named filter folders', () => {
  const panel = (name, flats) => filterOf(name, [sessionOf({
    path: `/r/M/${name}/n`,
    lights: [light(`/r/M/${name}/n/lights/l1.fits`, '2026-09-29T21:00:00', 'Ha')],
    flats,
  })], `/r/M/${name}`)
  const project = projectOf('M', [
    panel('Ha-panel1', [flat('/r/M/Ha-panel1/n/flats/f1.fits', '2026-09-29T19:00:00', 'Ha')]),
    panel('Ha-panel2', []),
  ], '/r/M')
  const out = applySharedFlats([project])
  const got = out[0].filters[1].sessions[0].calibration.sharedFlats
  assert.equal(got.filterName, 'Ha-panel1')
  assert.equal(got.projectName, 'M')
})

test('no match on a different filter, camera, binning or focal length', () => {
  assert.equal(sharedOf(applySharedFlats([lender('A'), borrower('B', 'Ha')]), 1).projectName, 'A')
  const mismatches = [
    { filter: 'OIII' },
    { instrume: 'ASI533MC' },
    { xbinning: 2, ybinning: 2 },
    { raw: { FOCALLEN: 430, FOCRATIO: 5.4 } },
    { naxis1: 200 },
  ]
  for (const o of mismatches) {
    const out = applySharedFlats([lender('A'), borrower('B', 'Ha', o)])
    assert.equal(sharedOf(out, 1), null, `should not match ${JSON.stringify(o)}`)
  }
})

test('no match on a different night', () => {
  const far = projectOf('B', [filterOf('Ha', [sessionOf({
    path: '/r/B/Ha/n',
    lights: [light('/r/B/Ha/n/lights/l1.fits', '2026-10-05T22:00:00', 'Ha')],
  })])], '/r/B')
  assert.equal(sharedOf(applySharedFlats([lender('A'), far]), 1), null)
})

test('a session with any flats of its own borrows nothing', () => {
  const own = projectOf('B', [filterOf('Ha', [sessionOf({
    path: '/r/B/Ha/n',
    lights: [light('/r/B/Ha/n/lights/l1.fits', '2026-09-29T22:00:00', 'Ha')],
    flats: [flat('/r/B/Ha/n/flats/stray.fits', '2026-09-29T19:00:00', 'Ha')],
  })])], '/r/B')
  assert.equal(sharedOf(applySharedFlats([lender('A'), own]), 1), null)
})

// Review Focus 1: stacked output often drops FILTER/INSTRUME.
test('a master-flat-only source offers nothing when the stack lost FILTER', () => {
  const stripped = { ...flat('/r/A/Ha/n/flats/masterFlat_Ha.xisf', '2026-09-29T19:00:00', 'Ha'), header: hdr({ naxis1: 100, naxis2: 100 }) }
  assert.equal(sharedOf(applySharedFlats([lender('A', 'Ha', [stripped]), borrower('B')]), 1), null)
  const kept = flat('/r/A/Ha/n/flats/masterFlat_Ha.xisf', '2026-09-29T19:00:00', 'Ha')
  const got = sharedOf(applySharedFlats([lender('A', 'Ha', [kept]), borrower('B')]), 1)
  assert.equal(got.isMaster, true)
  assert.deepEqual(got.flats.map((f) => f.filename), ['masterFlat_Ha.xisf'])
})

test('a stacked master flat is lent in preference to raw flats in the same source folder', () => {
  const flats = [
    flat('/r/A/Ha/n/flats/masterFlat_Ha.xisf', '2026-09-29T19:00:00', 'Ha'),
    flat('/r/A/Ha/n/flats/f1.fits', '2026-09-29T19:00:00', 'Ha'),
    flat('/r/A/Ha/n/flats/f2.fits', '2026-09-29T19:00:01', 'Ha'),
  ]
  const got = sharedOf(applySharedFlats([lender('A', 'Ha', flats), borrower('B')]), 1)
  assert.equal(got.isMaster, true)
  assert.deepEqual(got.flats.map((f) => f.filename), ['masterFlat_Ha.xisf'])
})

test('a lent master flat takes its identity from the raw flats when the stack lost its keywords', () => {
  const stripped = { ...flat('/r/A/Ha/n/flats/masterFlat_Ha.xisf', '2026-09-29T19:00:00', 'Ha'), header: hdr({ naxis1: 100, naxis2: 100 }) }
  const flats = [stripped, flat('/r/A/Ha/n/flats/f1.fits', '2026-09-29T19:00:00', 'Ha')]
  const got = sharedOf(applySharedFlats([lender('A', 'Ha', flats), borrower('B')]), 1)
  assert.equal(got.isMaster, true)
  assert.deepEqual(got.flats.map((f) => f.filename), ['masterFlat_Ha.xisf'])
})

test('DSLR sessions neither offer nor borrow', () => {
  const dslrLender = lender('A', 'Ha', [{ ...flat('/r/A/Ha/n/flats/f1.cr3', '2026-09-29T19:00:00', 'Ha') }])
  assert.equal(sharedOf(applySharedFlats([dslrLender, borrower('B')]), 1), null)
  const dslrBorrower = borrower('B')
  dslrBorrower.filters[0].sessions[0].lights[0].filename = 'l1.cr3'
  assert.equal(sharedOf(applySharedFlats([lender('A'), dslrBorrower]), 1), null)
})

test('tie-break prefers the same project, then the closest flats, then the larger set', () => {
  const own = filterOf('Ha-a', [sessionOf({
    path: '/r/B/Ha-a/n',
    lights: [light('/r/B/Ha-a/n/lights/l1.fits', '2026-09-29T21:00:00', 'Ha')],
    flats: [flat('/r/B/Ha-a/n/flats/own.fits', '2026-09-30T06:00:00', 'Ha')],
  })], '/r/B/Ha-a')
  const needs = filterOf('Ha-b', [sessionOf({
    path: '/r/B/Ha-b/n',
    lights: [light('/r/B/Ha-b/n/lights/l1.fits', '2026-09-29T21:00:00', 'Ha')],
  })], '/r/B/Ha-b')
  const withOwn = applySharedFlats([lender('A'), projectOf('B', [own, needs], '/r/B')])
  assert.equal(withOwn[1].filters[1].sessions[0].calibration.sharedFlats.projectName, 'B')

  const nearFlats = [flat('/r/C/Ha/n/flats/near.fits', '2026-09-29T21:10:00', 'Ha')]
  const near = lender('C', 'Ha', nearFlats)
  const out = applySharedFlats([lender('A'), near, borrower('B')])
  assert.equal(sharedOf(out, 2).projectName, 'C', 'closest in time wins')
})

// Review Focus 4: identical candidates, and a borrower with no timestamp.
test('indistinguishable candidates resolve deterministically', () => {
  const twin = (name) => lender(name, 'Ha', [flat(`/r/${name}/Ha/n/flats/f1.fits`, '2026-09-29T19:00:00', 'Ha')])
  const undated = borrower('B')
  undated.filters[0].sessions[0].lights[0].header = hdr({ ...RIG, filter: 'Ha', naxis1: 100, naxis2: 100 })
  undated.filters[0].sessions[0].date = '2026-09-29'
  const first = sharedOf(applySharedFlats([twin('A'), twin('C'), undated]), 2)
  const again = sharedOf(applySharedFlats([twin('A'), twin('C'), undated]), 2)
  assert.equal(first.projectName, again.projectName)
  const bigger = lender('D', 'Ha', [
    flat('/r/D/Ha/n/flats/f1.fits', '2026-09-29T19:00:00', 'Ha'),
    flat('/r/D/Ha/n/flats/f2.fits', '2026-09-29T19:00:00', 'Ha'),
  ])
  assert.equal(sharedOf(applySharedFlats([twin('A'), bigger, undated]), 2).projectName, 'D')
})

// Review Focus 5: a stale value must not survive a rebuild.
test('applySharedFlats clears a sharedFlats value that no longer resolves', () => {
  const matched = applySharedFlats([lender('A'), borrower('B')])
  assert.ok(sharedOf(matched, 1))
  const rebuilt = applySharedFlats([matched[1]])
  assert.equal(sharedOf(rebuilt, 0), null)
})

test('offerableFlats and buildFlatIndex expose the raw candidates', () => {
  const p = lender('A')
  const c = offerableFlats(p, p.filters[0], p.filters[0].sessions[0])
  assert.equal(c.sessionPath, '/r/A/Ha/n')
  assert.equal(c.takenAt, '2026-09-30T05:30:00')
  assert.equal(c.takenAtMs, Date.parse('2026-09-30T05:30:00Z'))
  assert.equal(buildFlatIndex([p]).size, 1)
  assert.equal(buildFlatIndex([borrower('B')]).size, 0)
  assert.equal(typeof findSharedFlats, 'function')
})
