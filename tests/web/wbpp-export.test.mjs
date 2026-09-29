import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDateObs, sanitizeKeywordValue, nightDateFor, resolveMoonContext,
  buildExportTree, exportFolderName,
  DEFAULT_EXPORT_SETTINGS, EMPTY_SELECTION, mergeSettings, frameExclusion,
  isFrameIncluded, calEnabled, buildPlan, predictPlacement, estimateSize,
  countByKind, exportWarnings,
} from '../../src/lib/wbppExport.ts'

const hdr = (o = {}) => ({ simple: true, bitpix: 16, naxis: 2, naxis1: 100, naxis2: 100, bscale: 1, bzero: 0, raw: {}, ...o })
const file = (path, sizeBytes = 100) => ({ filename: path.split('/').pop(), path, sizeBytes })
const session = (o) => ({
  date: 'Night 1', path: '/r/P/Ha/Night 1', lights: [], flats: [], darks: [], biases: [],
  integrationSeconds: 0, totalSizeBytes: 0, calibration: { darksMatched: false, flatsAvailable: false },
  hasNotes: false, subsDateRange: null, ...o,
})
const project = (filters) => ({
  name: 'M31', path: '/r/P', filters, totalIntegrationSeconds: 0, totalLightFrames: 0,
  totalFlatFrames: 0, totalSizeBytes: 0, lastCaptureDate: null, hasNotes: false,
})
const filterGroup = (name, sessions) => ({
  name, path: `/r/P/${name}`, sessions, otherFiles: [], totalIntegrationSeconds: 0,
  totalLightFrames: 0, totalSizeBytes: 0, hasNotes: false,
})
const master = (o) => ({
  filename: 'm.xisf', path: '/m/m.xisf', sizeBytes: 5000, format: 'xisf', exposureTime: 300,
  ccdTemp: -10, binning: 1, resolution: '100x100', camera: '', tempSource: 'filename', ...o,
})

test('parseDateObs handles zone-less, Z and garbage', () => {
  assert.equal(parseDateObs('2026-09-01T21:14:03.512').toISOString(), '2026-09-01T21:14:03.512Z')
  assert.equal(parseDateObs('2026-09-01T21:14:03Z').toISOString(), '2026-09-01T21:14:03.000Z')
  assert.equal(parseDateObs('2026-09-01T23:14:03+02:00').toISOString(), '2026-09-01T21:14:03.000Z')
  assert.equal(parseDateObs(null), null)
  assert.equal(parseDateObs(''), null)
  assert.equal(parseDateObs('not a date'), null)
})

test('sanitizeKeywordValue', () => {
  assert.equal(sanitizeKeywordValue('Ha 3nm'), 'Ha-3nm')
  assert.equal(sanitizeKeywordValue('L_Pro'), 'L-Pro')
  assert.equal(sanitizeKeywordValue('OIII/6nm'), 'OIII-6nm')
  assert.equal(sanitizeKeywordValue('  Śląsk__x  '), 'l-sk-x')
  assert.equal(sanitizeKeywordValue('___'), 'unknown')
})

test('nightDateFor uses earliest DATE-OBS minus 12 h, falls back to folder name', () => {
  const evening = new Date('2026-09-01T20:00:00Z')
  const afterMidnight = new Date('2026-09-02T03:00:00Z')
  assert.equal(nightDateFor([afterMidnight, evening], 'Night 1'), '2026-09-01')
  assert.equal(nightDateFor([afterMidnight], 'Night 1'), '2026-09-01')
  assert.equal(nightDateFor([], 'Night 1'), 'Night-1')
})

test('resolveMoonContext needs location and coordinates', () => {
  const withCoords = project([filterGroup('Ha', [session({
    lights: [{ ...file('/a.fits'), header: hdr({ raw: { OBJCTRA: '00 42 44', OBJCTDEC: '+41 16 09' } }) }],
  })])])
  assert.match(resolveMoonContext(withCoords, {}, null, null).reason, /location/)
  const ok = resolveMoonContext(withCoords, {}, 49.26, 22.68)
  assert.equal(ok.reason, null)
  assert.ok(Math.abs(ok.ctx.targetRa - 10.683) < 0.01)
  const noCoords = project([filterGroup('Ha', [session({ lights: [{ ...file('/a.fits'), header: hdr() }] })])])
  assert.match(resolveMoonContext(noCoords, {}, 49.26, 22.68).reason, /coordinates/)
})

test('resolveMoonContext prefers the imaging site recorded in the frame', () => {
  const raw = { RA: 60.85, DEC: 36.51, SITELAT: 51.1014, SITELONG: 16.9961 }
  const p = project([filterGroup('Ha', [session({ lights: [{ ...file('/a.fits'), header: hdr({ raw }) }] })])])
  const withSettings = resolveMoonContext(p, {}, 50.09, 22.02)
  assert.equal(withSettings.reason, null)
  assert.equal(withSettings.ctx.lat, 51.1014)
  assert.equal(withSettings.ctx.lon, 16.9961)
  const noSettings = resolveMoonContext(p, {}, null, null)
  assert.equal(noSettings.reason, null)
  assert.equal(noSettings.ctx.lat, 51.1014)
})

test('buildExportTree builds rows, flats split, masters, Moon and FWHM', () => {
  const p = project([filterGroup('Ha 3nm', [session({
    lights: [
      { ...file('/r/P/Ha/Night 1/lights/a.fits', 1000), header: hdr({ exptime: 300, ccdTemp: -10 }) },
      file('/r/P/Ha/Night 1/lights/b.fits', 1000),
    ],
    flats: [file('/f/masterFlat_Ha.xisf', 50), file('/f/flat1.fits', 10)],
    darks: [file('/d/dark1.fits', 10)],
  })])])
  const headers = {
    '/r/P/Ha/Night 1/lights/a.fits': hdr({ exptime: 300, ccdTemp: -10, dateObs: '2026-09-01T20:00:00' }),
    '/r/P/Ha/Night 1/lights/b.fits': null,
  }
  const tree = buildExportTree({
    project: p, headers,
    subAnalysis: { '/r/P/Ha/Night 1/lights/a.fits': { medianFwhm: 2.5, medianEccentricity: 0.4, starsDetected: 100 } },
    moon: { targetRa: 10.68, targetDec: 41.27, lat: 49.26, lon: 22.68 },
    library: { darks: [master({ filename: 'md.xisf', path: '/m/md.xisf' })], biases: [master({ filename: 'mb.xisf', path: '/m/mb.xisf' })], darkFlats: [], otherFiles: [], rootPath: '/m' },
    tempTolerance: 2,
  })
  assert.equal(tree.length, 1)
  assert.equal(tree[0].keyword, 'Ha-3nm')
  assert.equal(tree[0].analyzed, true)
  const night = tree[0].nights[0]
  assert.equal(night.nightDate, '2026-09-01')
  assert.equal(night.masterFlat.filename, 'masterFlat_Ha.xisf')
  assert.deepEqual(night.rawFlats.map((f) => f.filename), ['flat1.fits'])
  assert.equal(night.masterDark.path, '/m/md.xisf')
  assert.equal(night.masterBias.path, '/m/mb.xisf')
  const [a, b] = night.frames
  assert.equal(a.fwhm, 2.5)
  assert.equal(a.ecc, 0.4)
  assert.ok(a.moonSepDeg > 0 && a.moonSepDeg < 180)
  assert.ok(a.moonIllum >= 0 && a.moonIllum <= 1)
  assert.equal(b.dateObs, null)
  assert.equal(b.moonSepDeg, null)
  assert.equal(b.fwhm, null)
})

test('buildExportTree skips sessions without lights and DSLR masters', () => {
  const p = project([filterGroup('L', [
    session({ path: '/s1' }),
    session({ path: '/s2', lights: [{ ...file('/x/IMG_1.CR2'), header: hdr({ exptime: 300, ccdTemp: -10 }) }] }),
  ])])
  const tree = buildExportTree({
    project: p, headers: {}, subAnalysis: {}, moon: null,
    library: { darks: [master({})], biases: [], darkFlats: [], otherFiles: [], rootPath: '/m' }, tempTolerance: 2,
  })
  assert.deepEqual(tree[0].nights.map((n) => n.key), ['/s2'])
  assert.equal(tree[0].nights[0].isDslr, true)
  assert.equal(tree[0].nights[0].masterDark, null)
})

test('buildExportTree disambiguates filter names that sanitize to the same keyword', () => {
  const p = project([
    filterGroup('Hα', [session({ path: '/s1', lights: [file('/a.fits')] })]),
    filterGroup('Hβ', [session({ path: '/s2', lights: [file('/b.fits')] })]),
  ])
  const tree = buildExportTree({
    project: p, headers: {}, subAnalysis: {}, moon: null, library: null, tempTolerance: 2,
  })
  assert.equal(tree.length, 2)
  assert.notEqual(tree[0].keyword, tree[1].keyword)
  assert.equal(tree[0].keyword, 'H')
  assert.equal(tree[1].keyword, 'H-2')
})

test('exportFolderName', () => {
  assert.equal(exportFolderName('M31: Andromeda', new Date(2026, 8, 24)), 'M31- Andromeda_WBPP_2026-09-24')
})

const row = (path, o = {}) => ({
  path, filename: path.split('/').pop(), sizeBytes: 100, dateObs: '2026-09-01T20:00:00',
  moonSepDeg: 90, moonIllum: 0.5, moonAltDeg: 20, fwhm: 2, ecc: 0.3, ...o,
})
const night = (o = {}) => ({
  key: '/s1', sessionName: 'Night 1', nightDate: '2026-09-01', exposure: 300, ccdTemp: -10, isDslr: false,
  frames: [row('/l/a.fits'), row('/l/b.fits')],
  masterFlat: null, rawFlats: [], darks: [], biases: [], masterDark: null, masterBias: null,
  masterDarkFlat: null, flatExposure: null, ...o,
})
const tree1 = (n, name = 'Ha', keyword = 'Ha') => [{ name, keyword, nights: Array.isArray(n) ? n : [n], analyzed: true }]
const S = (o = {}) => ({ ...DEFAULT_EXPORT_SETTINGS, ...o, include: { ...DEFAULT_EXPORT_SETTINGS.include, ...(o.include ?? {}) } })
const sel = (o = {}) => ({ ...EMPTY_SELECTION, ...o })

test('mergeSettings tolerates junk and partial input', () => {
  assert.deepEqual(mergeSettings(null), DEFAULT_EXPORT_SETTINGS)
  assert.deepEqual(mergeSettings('x'), DEFAULT_EXPORT_SETTINGS)
  const m = mergeSettings({ moonMinSepDeg: 45, include: { dark: true, bogus: 1 }, fwhmMax: 'x' })
  assert.equal(m.moonMinSepDeg, 45)
  assert.equal(m.include.dark, true)
  assert.equal(m.include.light, true)
  assert.equal(m.fwhmMax, null)
  assert.equal('bogus' in m.include, false)
})

test('frameExclusion: Moon, horizon, FWHM, eccentricity', () => {
  const on = S({ moonCutoffEnabled: true, moonMinSepDeg: 30 })
  assert.equal(frameExclusion(row('/a', { moonSepDeg: 18.4 }), on), 'Moon 18°')
  assert.equal(frameExclusion(row('/a', { moonSepDeg: 18.4, moonAltDeg: -5 }), on), null)
  assert.equal(frameExclusion(row('/a', { moonSepDeg: 18.4, moonAltDeg: -5 }), S({ ...on, moonOnlyAboveHorizon: false })), 'Moon 18°')
  assert.equal(frameExclusion(row('/a', { moonSepDeg: null }), on), null)
  assert.equal(frameExclusion(row('/a', { moonSepDeg: 18 }), S()), null)
  assert.equal(frameExclusion(row('/a', { fwhm: 4.24 }), S({ fwhmMax: 3 })), 'FWHM 4.2')
  assert.equal(frameExclusion(row('/a', { fwhm: null }), S({ fwhmMax: 3 })), null)
  assert.equal(frameExclusion(row('/a', { ecc: 0.62 }), S({ eccMax: 0.5 })), 'Ecc 0.62')
})

test('isFrameIncluded: manual override beats cutoff; disabled night wins', () => {
  const n = night({ frames: [row('/l/a.fits', { fwhm: 5 })] })
  const s = S({ fwhmMax: 3 })
  assert.equal(isFrameIncluded(n.frames[0], n, s, sel()), false)
  assert.equal(isFrameIncluded(n.frames[0], n, s, sel({ frameOverrides: { '/l/a.fits': true } })), true)
  assert.equal(isFrameIncluded(n.frames[0], n, S(), sel({ frameOverrides: { '/l/a.fits': false } })), false)
  assert.equal(isFrameIncluded(n.frames[0], n, S(), sel({ disabledNights: ['/s1'], frameOverrides: { '/l/a.fits': true } })), false)
  assert.equal(isFrameIncluded(n.frames[0], n, S({ include: { light: false } }), sel()), false)
})

test('calEnabled: raw flats off by default when a master flat exists; per-night override', () => {
  const withMaster = night({ masterFlat: { path: '/f/mf.xisf', filename: 'mf.xisf', sizeBytes: 1 }, rawFlats: [{ path: '/f/1.fits', filename: '1.fits', sizeBytes: 1 }] })
  assert.equal(calEnabled(withMaster, 'masterFlat', S(), sel()), true)
  assert.equal(calEnabled(withMaster, 'flat', S(), sel()), false)
  assert.equal(calEnabled(withMaster, 'flat', S(), sel({ nightCal: { '/s1': { flat: true } } })), true)
  assert.equal(calEnabled(night({ rawFlats: withMaster.rawFlats }), 'flat', S(), sel()), true)
  assert.equal(calEnabled(night(), 'dark', S(), sel()), false)
})

test('buildPlan lays out WBPP keyword folders and dedupes masters', () => {
  const md = { path: '/m/md.xisf', filename: 'md.xisf', sizeBytes: 5000 }
  const n1 = night({ key: '/s1', masterDark: md, masterFlat: { path: '/f1/mf.xisf', filename: 'mf.xisf', sizeBytes: 50 }, darks: [{ path: '/d/d1.fits', filename: 'd1.fits', sizeBytes: 10 }] })
  const n2 = night({ key: '/s2', nightDate: '2026-09-03', frames: [row('/l2/c.fits')], masterDark: md })
  const plan = buildPlan(tree1([n1, n2]), S({ include: { dark: true } }), sel())
  assert.deepEqual(plan.map((e) => [e.kind, e.relDst]), [
    ['light', 'Lights/NIGHT_2026-09-01/FILTER_Ha/a.fits'],
    ['light', 'Lights/NIGHT_2026-09-01/FILTER_Ha/b.fits'],
    ['masterFlat', 'Flats/NIGHT_2026-09-01/FILTER_Ha/mf.xisf'],
    ['masterDark', 'Darks/md.xisf'],
    ['dark', 'Darks/NIGHT_2026-09-01/d1.fits'],
    ['light', 'Lights/NIGHT_2026-09-03/FILTER_Ha/c.fits'],
  ])
})

test('buildPlan skips calibration of nights with no included lights', () => {
  const n = night({ frames: [row('/l/a.fits', { fwhm: 9 })], masterFlat: { path: '/f/mf.xisf', filename: 'mf.xisf', sizeBytes: 1 } })
  assert.deepEqual(buildPlan(tree1(n), S({ fwhmMax: 3 }), sel()), [])
})

test('buildPlan suffixes colliding destination names', () => {
  const n1 = night({ key: '/s1', frames: [row('/x/L_001.fits')] })
  const n2 = night({ key: '/s2', frames: [row('/y/L_001.fits'), row('/z/L_001.fits')] })
  const plan = buildPlan(tree1([n1, n2]), S(), sel())
  assert.deepEqual(plan.map((e) => e.relDst), [
    'Lights/NIGHT_2026-09-01/FILTER_Ha/L_001.fits',
    'Lights/NIGHT_2026-09-01/FILTER_Ha/L_001_1.fits',
    'Lights/NIGHT_2026-09-01/FILTER_Ha/L_001_2.fits',
  ])
})

test('predictPlacement and estimateSize', () => {
  const ok = { ok: true, reason: null }
  const bad = { ok: false, reason: 'x' }
  assert.equal(predictPlacement(null), null)
  assert.equal(predictPlacement({ symlink: ok, hardlink: ok, freeBytes: 1 }), 'symlink')
  assert.equal(predictPlacement({ symlink: bad, hardlink: ok, freeBytes: 1 }), 'hardlink')
  assert.equal(predictPlacement({ symlink: bad, hardlink: bad, freeBytes: 1 }), 'copy')
  const plan = [{ src: '/a', relDst: 'a', kind: 'light', sizeBytes: 300 }, { src: '/b', relDst: 'b', kind: 'flat', sizeBytes: 200 }]
  assert.deepEqual(estimateSize(plan, 'symlink'), { sourceBytes: 500, diskBytes: 0 })
  assert.deepEqual(estimateSize(plan, 'hardlink'), { sourceBytes: 500, diskBytes: 0 })
  assert.deepEqual(estimateSize(plan, 'copy'), { sourceBytes: 500, diskBytes: 500 })
  assert.deepEqual(estimateSize(plan, null), { sourceBytes: 500, diskBytes: 500 })
  assert.equal(countByKind(plan).light, 1)
  assert.equal(countByKind(plan).masterDark, 0)
})

test('exportWarnings', () => {
  const n = night({ frames: [row('/l/a.fits', { moonSepDeg: null })] })
  const w = exportWarnings(tree1(n), S({ moonCutoffEnabled: true }), sel(), null)
  assert.ok(w.includes('Night 1 / Ha: no flats'))
  assert.ok(w.includes('Night 1 / Ha: no master dark matches 300 s @ -10 °C'))
  assert.ok(w.includes('1 frame without DATE-OBS — Moon filter not applied'))
  const w2 = exportWarnings(tree1(n), S({ moonCutoffEnabled: true }), sel(), 'no target coordinates in FITS headers')
  assert.ok(w2.includes('Moon filter unavailable: no target coordinates in FITS headers'))
  assert.deepEqual(exportWarnings(tree1(n), S(), sel({ disabledNights: ['/s1'] }), null), [])
})

const df = { path: '/m/mdf.xisf', filename: 'mdf.xisf', sizeBytes: 900 }
const raw = [{ path: '/f/1.fits', filename: '1.fits', sizeBytes: 1 }]
const mf = { path: '/f/mf.xisf', filename: 'mf.xisf', sizeBytes: 1 }

test('buildExportTree matches a darkflat against the raw flat header', () => {
  const p = project([filterGroup('Ha', [session({
    lights: [{ ...file('/l/a.fits'), header: hdr({ exptime: 300, ccdTemp: -19 }) }],
    flats: [{ ...file('/f/F1.fits'), header: hdr({ exptime: 0.04, ccdTemp: -19 }) }],
  })])])
  const tree = buildExportTree({
    project: p, headers: {}, subAnalysis: {}, moon: null, tempTolerance: 2,
    library: { darks: [], biases: [], darkFlats: [master({ filename: 'mdf.xisf', path: '/m/mdf.xisf', exposureTime: 0.04, ccdTemp: -19 })], otherFiles: [], rootPath: '/m' },
  })
  assert.equal(tree[0].nights[0].masterDarkFlat.path, '/m/mdf.xisf')
  assert.equal(tree[0].nights[0].flatExposure, 0.04)
})

test('calEnabled: darkflat follows raw flats; per-night override wins', () => {
  assert.equal(calEnabled(night({ rawFlats: raw, masterDarkFlat: df }), 'masterDarkFlat', S(), sel()), true)
  assert.equal(calEnabled(night({ masterFlat: mf, rawFlats: raw, masterDarkFlat: df }), 'masterDarkFlat', S(), sel()), false)
  assert.equal(calEnabled(night({ masterFlat: mf, masterDarkFlat: df }), 'masterDarkFlat', S(), sel({ nightCal: { '/s1': { masterDarkFlat: true } } })), true)
  assert.equal(calEnabled(night({ rawFlats: raw, masterDarkFlat: df }), 'masterDarkFlat', S({ include: { masterDarkFlat: false } }), sel()), false)
})

test('buildPlan puts one shared darkflat in Darks/', () => {
  const n1 = night({ key: '/s1', rawFlats: raw, masterDarkFlat: df })
  const n2 = night({ key: '/s2', nightDate: '2026-09-03', frames: [row('/l2/c.fits')], rawFlats: [{ path: '/f/2.fits', filename: '2.fits', sizeBytes: 1 }], masterDarkFlat: df })
  const plan = buildPlan(tree1([n1, n2]), S(), sel())
  assert.deepEqual(plan.filter((e) => e.kind === 'masterDarkFlat').map((e) => e.relDst), ['Darks/mdf.xisf'])
})

test('master bias is off by default, master darkflat on', () => {
  assert.equal(DEFAULT_EXPORT_SETTINGS.include.masterBias, false)
  assert.equal(DEFAULT_EXPORT_SETTINGS.include.masterDarkFlat, true)
})

test('exportWarnings: missing darkflat only with raw flats, and can be switched off', () => {
  const n = night({ rawFlats: raw, flatExposure: 0.04, ccdTemp: -19 })
  const msg = 'Night 1 / Ha: raw flats but no master darkflat matches 0.04 s @ -19 °C'
  assert.ok(exportWarnings(tree1(n), S(), sel(), null).includes(msg))
  assert.ok(!exportWarnings(tree1(n), S(), sel(), null, { warnMissingDarkFlat: false }).includes(msg))
  assert.ok(!exportWarnings(tree1(night({ masterFlat: mf, rawFlats: raw })), S(), sel(), null).some((w) => w.includes('darkflat')))
  assert.ok(!exportWarnings(tree1(night({ rawFlats: raw, masterDarkFlat: df })), S(), sel(), null).some((w) => w.includes('darkflat')))
  const unknown = exportWarnings(tree1(night({ rawFlats: raw })), S(), sel(), null)
  assert.ok(unknown.includes('Night 1 / Ha: raw flats but no master darkflat matches -10 °C'))
})
