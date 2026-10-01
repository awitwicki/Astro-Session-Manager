import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  newFiles, rigOf, rigCompatible, groupLights, groupFlats,
  folderReference, nightNumber, rankFolders, proposeFolder, assignSessionNames, proposeFlatDestination,
  withLightRows, buildProposal, validateProposal, planImport, proposalTotals,
} from '../../src/lib/asiairImport.ts'

// M31-ish pointing; every sub defaults to it unless `raw` is given.
const at = (ra, dec, extra = {}) => ({ RA: ra, DEC: dec, FOCALLEN: 540, ...extra })
const hdr = (o = {}) => ({
  simple: true, bitpix: 16, naxis: 2, naxis1: 6248, naxis2: 4176, bscale: 1, bzero: 0,
  instrume: 'ZWO ASI2600MM Pro', filter: 'Ha', exptime: 180, ccdTemp: -10,
  dateObs: '2026-09-29T21:00:00',
  ...o,
  raw: o.raw ?? at(10.68, 41.27),
})
let seq = 0
const light = (o = {}, extra = {}) => {
  const n = ++seq
  return { path: `/asiair/Light_${n}.fit`, filename: `Light_${n}.fit`, sizeBytes: 100, kind: 'light', header: hdr(o), ...extra }
}
const flat = (o = {}, extra = {}) => {
  const n = ++seq
  return { path: `/asiair/Flat_${n}.fit`, filename: `Flat_${n}.fit`, sizeBytes: 50, kind: 'flat', header: hdr({ exptime: 2, raw: {}, ...o }), ...extra }
}
const opts = { matchTemperature: true, tempTolerance: 2 }

// Library fixtures.
const session = (date, lights = [], flats = []) => ({
  date, path: '', lights, flats, darks: [], biases: [], integrationSeconds: 0, totalSizeBytes: 0,
  calibration: { darksMatched: false, flatsAvailable: false }, hasNotes: false, subsDateRange: null,
})
const libLight = (header, filename = 'old.fit', sizeBytes = 100) => ({ filename, path: `/lib/${filename}`, sizeBytes, header })
const project = (name, folders) => {
  const path = `/lib/${name}`
  return {
    name, path, totalIntegrationSeconds: 0, totalLightFrames: 0, totalFlatFrames: 0, totalSizeBytes: 0,
    lastCaptureDate: null, hasNotes: false,
    filters: folders.map(([folderName, sessions]) => ({
      name: folderName, path: `${path}/${folderName}`, otherFiles: [], totalIntegrationSeconds: 0,
      totalLightFrames: 0, totalSizeBytes: 0, hasNotes: false,
      sessions: sessions.map((s) => ({ ...s, path: `${path}/${folderName}/${s.date}` })),
    })),
  }
}

test('newFiles drops a file already in the library by name and size only', () => {
  const a = light({}, { filename: 'Light_A.fit', sizeBytes: 100 })
  const b = light({}, { filename: 'Light_B.fit', sizeBytes: 100 })
  const c = light({}, { filename: 'Light_C.fit', sizeBytes: 100 })
  const projects = [project('M31', [['Ha', [session('Night 1', [libLight(hdr(), 'Light_A.fit', 100), libLight(hdr(), 'Light_B.fit', 999)], [libLight(hdr(), 'Light_C.fit', 100)])]]])]
  assert.deepEqual(newFiles([a, b, c], projects).map((f) => f.filename), ['Light_B.fit'])
})

test('rigCompatible ignores FILTER and compares TELESCOP only when both report it', () => {
  const base = rigOf(hdr({ telescop: 'RedCat 51' }))
  assert.equal(rigCompatible(base, rigOf(hdr({ filter: 'OIII', telescop: 'RedCat 51' }))), true)
  assert.equal(rigCompatible(base, rigOf(hdr({ telescop: undefined }))), true)
  assert.equal(rigCompatible(base, rigOf(hdr({ telescop: 'C8' }))), false)
  assert.equal(rigCompatible(base, rigOf(hdr({ instrume: 'ASI533MC' }))), false)
  assert.equal(rigOf(hdr({ instrume: undefined })), null)
})

test('groupLights keeps 23:50 and 02:10 local (UTC 21:50 / 00:10) on one night', () => {
  const { groups } = groupLights([
    light({ dateObs: '2026-09-29T21:50:00' }),
    light({ dateObs: '2026-09-30T00:10:00' }),
    light({ dateObs: '2026-09-30T20:00:00' }),
  ], opts)
  assert.deepEqual(groups.map((g) => [g.nightKey, g.files.length]), [['2026-09-29', 2], ['2026-09-30', 1]])
})

test('groupLights splits on FILTER, exposure, position and rig', () => {
  const { groups } = groupLights([
    light(),
    light({ dateObs: '2026-09-29T21:05:00' }),
    light({ filter: 'OIII' }),
    light({ filter: undefined }),
    light({ exptime: 30 }),
    light({ exptime: 180.4 }),
    light({ raw: at(10.68, 41.87) }),
    light({ instrume: 'ASI533MC' }),
  ], opts)
  // Same-timestamp subs order by path, so compare sizes, not positions.
  const sizes = (gs) => gs.map((g) => g.files.length).sort((a, b) => b - a)
  assert.deepEqual(sizes(groups), [3, 1, 1, 1, 1, 1])
})

test('groupLights splits on temperature only while the option is on', () => {
  const sizes = (gs) => gs.map((g) => g.files.length).sort((a, b) => b - a)
  // A sub without CCD-TEMP first must not absorb both temperatures.
  const subs = [
    light({ ccdTemp: undefined, dateObs: '2026-09-29T21:00:00' }),
    light({ ccdTemp: -10, dateObs: '2026-09-29T21:01:00' }),
    light({ ccdTemp: -5, dateObs: '2026-09-29T21:02:00' }),
  ]
  assert.deepEqual(sizes(groupLights(subs, opts).groups), [2, 1])
  assert.deepEqual(sizes(groupLights(subs, { ...opts, matchTemperature: false }).groups), [3])
})

test('groupLights counts subs it cannot place', () => {
  const { groups, unplaceable } = groupLights([
    light({ dateObs: undefined }),
    light({ raw: {} }),
    light({ instrume: undefined }),
    light({ exptime: undefined }),
    light(),
    flat(),
  ], opts)
  assert.equal(groups.length, 1)
  assert.equal(unplaceable, 4)
})

test('groupLights reads OBJCTRA/OBJCTDEC as written by capture software', () => {
  const { groups } = groupLights([
    light({ raw: { OBJCTRA: '00 42 44', OBJCTDEC: '+41 16 09' } }),
    light(),
  ], opts)
  assert.equal(groups.length, 1)
})

test('groupFlats groups by night, FILTER and rig; position plays no part', () => {
  const { groups } = groupFlats([
    flat({ dateObs: '2026-09-30T04:30:00' }),
    flat({ dateObs: '2026-09-30T04:31:00' }),
    flat({ dateObs: '2026-09-30T04:40:00', filter: 'OIII' }),
    flat({ dateObs: '2026-09-30T19:00:00' }),
    light(),
  ])
  assert.deepEqual(groups.map((g) => [g.nightKey, g.filter, g.files.length]), [
    ['2026-09-29', 'Ha', 2], ['2026-09-29', 'OIII', 1], ['2026-09-30', 'Ha', 1],
  ])
})

// A library with an M31 project (UV/IR-cut 30 s and dual-band 180 s folders),
// a two-panel mosaic 0.4° apart, and an unrelated target far away.
const lib = () => [
  project('M31', [
    ['UVIR', [session('Night 1', [libLight(hdr({ filter: 'UVIR', exptime: 30, dateObs: '2026-09-01T21:00:00' }))])]],
    ['Dualband', [session('Night 1', [libLight(hdr({ filter: 'LeXtreme', exptime: 180, dateObs: '2026-09-01T21:00:00' }))])]],
  ]),
  project('Veil mosaic', [
    ['Panel 1', [session('Night 1', [libLight(hdr({ raw: at(312.0, 30.0), dateObs: '2026-09-01T21:00:00' }))])]],
    ['Panel 2', [session('Night 1', [libLight(hdr({ raw: at(312.0, 30.4), dateObs: '2026-09-01T21:00:00' }))])]],
  ]),
  project('M42', [['Ha', [session('Night 1', [libLight(hdr({ raw: at(83.8, -5.4) }))])]]]),
]
const groupOf = (subs) => groupLights(subs, opts).groups[0]

test('nightNumber reads Night folder names', () => {
  assert.equal(nightNumber('Night 7'), 7)
  assert.equal(nightNumber('night12'), 12)
  assert.equal(nightNumber('2026-09-29'), null)
})

test('folderReference takes the latest session by DATE-OBS, else by Night number', () => {
  const byDate = project('P', [['F', [
    session('Night 2', [libLight(hdr({ dateObs: '2026-09-10T21:00:00', exptime: 60 }))]),
    session('Night 10', [libLight(hdr({ dateObs: '2026-09-20T21:00:00', exptime: 120 }))]),
  ]]]).filters[0]
  assert.equal(folderReference(byDate).exptime, 120)
  const undated = project('P', [['F', [
    session('Night 10', [libLight(hdr({ dateObs: undefined, exptime: 120 }))]),
    session('Night 9', [libLight(hdr({ dateObs: undefined, exptime: 60 }))]),
  ]]]).filters[0]
  assert.equal(folderReference(undated).exptime, 120)
  assert.equal(folderReference(project('P', [['F', [session('Night 1')]]]).filters[0]), null)
})

test('exposure separates two folders on the same target', () => {
  const g = groupOf([light({ filter: 'LeXtreme', exptime: 180 })])
  const p = proposeFolder(g, lib())
  assert.equal(p.status, 'matched')
  assert.equal(p.folder.filterName, 'Dualband')
  assert.equal(proposeFolder(groupOf([light({ filter: 'UVIR', exptime: 30 })]), lib()).folder.filterName, 'UVIR')
})

test('mosaic panels 0.4° apart each get their own folder', () => {
  assert.equal(proposeFolder(groupOf([light({ raw: at(312.0, 30.02) })]), lib()).folder.filterName, 'Panel 1')
  assert.equal(proposeFolder(groupOf([light({ raw: at(312.0, 30.38) })]), lib()).folder.filterName, 'Panel 2')
})

test('nothing within 1° or an incompatible rig is unmatched', () => {
  assert.equal(proposeFolder(groupOf([light({ raw: at(150, 10) })]), lib()).status, 'unmatched')
  assert.equal(proposeFolder(groupOf([light({ instrume: 'ASI533MC' })]), lib()).status, 'unmatched')
})

test('two projects tying on distance, exposure and FILTER give no proposal', () => {
  const twin = [
    project('M31 2025', [['Ha', [session('Night 1', [libLight(hdr())])]]]),
    project('M31 2026', [['Ha', [session('Night 1', [libLight(hdr())])]]]),
  ]
  assert.equal(proposeFolder(groupOf([light()]), twin).status, 'ambiguous')
  assert.equal(rankFolders(groupOf([light()]), twin).length, 2)
})

test('assignSessionNames numbers past the highest Night, in night order', () => {
  const projects = [project('P', [['F', [session('Night 9', [libLight(hdr({ dateObs: '2026-09-01T21:00:00' }))]), session('Night 10', [libLight(hdr({ dateObs: '2026-09-02T21:00:00' }))])]]])]
  const folder = { projectPath: '/lib/P', projectName: 'P', filterPath: '/lib/P/F', filterName: 'F' }
  const g1 = groupOf([light({ dateObs: '2026-09-29T21:00:00' })])
  const g2 = groupOf([light({ dateObs: '2026-09-28T21:00:00' })])
  const rows = assignSessionNames([
    { id: 'a', group: g1, include: true, folder, sessionName: '', nameEdited: false },
    { id: 'b', group: g2, include: true, folder, sessionName: '', nameEdited: false },
    { id: 'c', group: g2, include: false, folder, sessionName: 'x', nameEdited: false },
  ], projects)
  assert.deepEqual(rows.map((r) => r.sessionName), ['Night 12', 'Night 11', ''])
  const edited = assignSessionNames([{ ...rows[0], sessionName: 'Night 20', nameEdited: true }, rows[1]], projects)
  assert.deepEqual(edited.map((r) => r.sessionName), ['Night 20', 'Night 21'])
})

test('buildProposal: dedupes, matches, names, and counts the unmatched', () => {
  const projects = lib()
  projects[0].filters[1].sessions[0].lights.push(libLight(hdr(), 'Light_dup.fit', 100))
  const scan = {
    files: [
      light({ filter: 'LeXtreme', exptime: 180 }),
      light({ filter: 'LeXtreme', exptime: 180 }, { filename: 'Light_dup.fit' }),
      light({ raw: at(312.0, 30.02), dateObs: '2026-09-29T22:00:00' }),
      light({ raw: at(150, 10) }),
      light({ raw: at(150, 10) }),
      light({ dateObs: undefined }),
    ],
    unreadable: [{ path: '/asiair/x.fit', error: 'Unexpected end' }],
  }
  const p = buildProposal(scan, projects, opts)
  assert.deepEqual(p.lightRows.map((r) => [r.folder.filterName, r.sessionName, r.group.files.length, r.include]), [
    ['Dualband', 'Night 2', 1, true],
    ['Panel 1', 'Night 2', 1, true],
  ])
  assert.equal(p.unmatchedCount, 3)
  assert.equal(p.unreadable.length, 1)
})

test('an ambiguous group is shown unticked with no folder', () => {
  const twin = [
    project('M31 2025', [['Ha', [session('Night 1', [libLight(hdr())])]]]),
    project('M31 2026', [['Ha', [session('Night 1', [libLight(hdr())])]]]),
  ]
  const p = buildProposal({ files: [light()], unreadable: [] }, twin, opts)
  assert.equal(p.lightRows.length, 1)
  assert.equal(p.lightRows[0].include, false)
  assert.equal(p.lightRows[0].folder, null)
})

test('flats go to the same-night same-FILTER row; nights without light rows are hidden', () => {
  const scan = {
    files: [
      light({ filter: 'LeXtreme', exptime: 180 }),
      flat({ filter: 'LeXtreme', dateObs: '2026-09-30T04:30:00' }),
      flat({ filter: 'OIII', dateObs: '2026-09-30T04:40:00' }),
      flat({ filter: 'LeXtreme', dateObs: '2026-10-05T04:30:00' }),
    ],
    unreadable: [],
  }
  const p = buildProposal(scan, lib(), opts)
  assert.equal(p.flatRows.length, 2)
  assert.deepEqual(p.flatRows[0].destination, { kind: 'row', rowId: p.lightRows[0].id })
  assert.deepEqual(p.flatRows[1].destination, { kind: 'skip' })
  assert.equal(p.unmatchedCount, 1)
  assert.deepEqual(proposeFlatDestination(p.flatRows[0].group, []), { kind: 'skip' })
})

test('excluding the row a flat set points to re-proposes the flats', () => {
  const projects = lib()
  const scan = {
    files: [
      light({ filter: 'LeXtreme', exptime: 180 }),
      light({ filter: 'LeXtreme', exptime: 180, raw: at(312.0, 30.02), dateObs: '2026-09-29T23:00:00' }),
      flat({ filter: 'LeXtreme', dateObs: '2026-09-30T04:30:00' }),
    ],
    unreadable: [],
  }
  const p = buildProposal(scan, projects, opts)
  const [first, second] = p.lightRows
  assert.deepEqual(p.flatRows[0].destination, { kind: 'row', rowId: first.id })
  const next = withLightRows(p, [{ ...first, include: false }, second], projects)
  assert.deepEqual(next.flatRows[0].destination, { kind: 'row', rowId: second.id })
  const none = withLightRows(p, [{ ...first, include: false }, { ...second, include: false }], projects)
  assert.deepEqual(none.flatRows[0].destination, { kind: 'skip' })
})

test('validateProposal blocks bad names, duplicates and missing folders; warns on existing nights', () => {
  const projects = lib()
  const p = buildProposal({ files: [
    light({ filter: 'LeXtreme', exptime: 180 }),
    light({ filter: 'LeXtreme', exptime: 180, dateObs: '2026-09-30T21:00:00' }),
    light({ raw: at(312.0, 30.02), dateObs: '2026-10-01T21:00:00' }),
  ], unreadable: [] }, projects, opts)
  const [a, b, c] = p.lightRows
  const issues = (rows) => validateProposal({ ...p, lightRows: rows }, projects)

  assert.equal(issues(p.lightRows).size, 0)
  assert.equal(issues([a, { ...b, sessionName: a.sessionName, nameEdited: true }, c]).get(b.id).level, 'error')
  assert.match(issues([{ ...a, sessionName: 'Ha extra', nameEdited: true }, b, c]).get(a.id).message, /Night/)
  assert.equal(issues([{ ...a, folder: null }, b, c]).get(a.id).level, 'error')
  const existing = issues([{ ...a, sessionName: 'Night 1', nameEdited: true }, b, c]).get(a.id)
  assert.equal(existing.level, 'warning')
  assert.match(existing.message, /existing Night 1/)
  assert.equal(issues([{ ...a, include: false, folder: null }, b, c]).size, 0)
})

test('planImport and proposalTotals cover included rows and imported flats only', () => {
  const projects = lib()
  const p = buildProposal({ files: [
    light({ filter: 'LeXtreme', exptime: 180 }, { sizeBytes: 1000 }),
    light({ raw: at(312.0, 30.02), dateObs: '2026-09-29T22:00:00' }, { sizeBytes: 500 }),
    flat({ filter: 'LeXtreme', dateObs: '2026-09-30T04:30:00' }, { sizeBytes: 10 }),
  ], unreadable: [] }, projects, opts)
  const rows = [p.lightRows[0], { ...p.lightRows[1], include: false }]
  const plan = planImport({ ...p, lightRows: rows })
  assert.deepEqual(plan.sessions, [{ rowId: rows[0].id, filterPath: '/lib/M31/Dualband', sessionName: 'Night 2', subfolders: ['lights', 'flats'] }])
  assert.deepEqual(plan.copies.map((c) => [c.sub, c.files.length, c.target, c.label]), [
    ['lights', 1, { rowId: rows[0].id }, 'Lights → M31 / Dualband / Night 2'],
    ['flats', 1, { rowId: rows[0].id }, 'Flats → M31 / Dualband / Night 2'],
  ])
  assert.deepEqual(proposalTotals({ ...p, lightRows: rows }), { nights: 1, sessions: 1, files: 2, bytes: 1010 })

  const toSession = { ...p, lightRows: rows, flatRows: [{ ...p.flatRows[0], destination: { kind: 'session', sessionPath: '/lib/M42/Ha/Night 1', label: 'M42 / Ha / Night 1' } }] }
  assert.deepEqual(planImport(toSession).copies[1].target, { sessionPath: '/lib/M42/Ha/Night 1' })
  assert.equal(planImport(toSession).copies[1].label, 'Flats → M42 / Ha / Night 1')
  // Flats sent elsewhere: the new session gets no empty flats folder.
  assert.deepEqual(planImport(toSession).sessions[0].subfolders, ['lights'])
})

// Review fix I1: a rerun after an interrupted copy must top up the session it
// started, not open a second one for the same night.
test('leftover subs of a night already in the folder go to that session, not Night max+1', () => {
  const projects = [project('P', [['F', [
    session('Night 1', [libLight(hdr({ dateObs: '2026-09-01T21:00:00' }), 'Light_a.fit')]),
    session('Night 2', [libLight(hdr({ dateObs: '2026-09-29T21:30:00' }), 'Light_b.fit')]),
  ]]])]
  const p = buildProposal({ files: [
    light({ dateObs: '2026-09-29T22:30:00' }),
    light({ dateObs: '2026-09-29T23:30:00', exptime: 60 }),
    light({ dateObs: '2026-09-30T21:00:00' }),
  ], unreadable: [] }, projects, opts)
  assert.deepEqual(p.lightRows.map((r) => r.sessionName), ['Night 2', 'Night 3', 'Night 4'])
  assert.equal(validateProposal(p, projects).get(p.lightRows[0].id).level, 'warning')
})

// Review fix I2: the scanner's `^night\s*\d+$` is not trimmed.
test('planImport trims the session name so the folder is one the scanner recognises', () => {
  const projects = lib()
  const p = buildProposal({ files: [light({ filter: 'LeXtreme', exptime: 180 })], unreadable: [] }, projects, opts)
  const rows = withLightRows(p, [{ ...p.lightRows[0], sessionName: ' Night 5 ', nameEdited: true }], projects).lightRows
  const plan = planImport({ ...p, lightRows: rows })
  assert.equal(plan.sessions[0].sessionName, 'Night 5')
  assert.equal(plan.copies[0].label, 'Lights → M31 / Dualband / Night 5')
})

// Review fix I3.
test('an edited session name survives unticking and re-ticking its row', () => {
  const projects = lib()
  const p = buildProposal({ files: [light({ filter: 'LeXtreme', exptime: 180 })], unreadable: [] }, projects, opts)
  const edited = withLightRows(p, [{ ...p.lightRows[0], sessionName: 'Night 12', nameEdited: true }], projects)
  const off = withLightRows(edited, [{ ...edited.lightRows[0], include: false }], projects)
  const on = withLightRows(off, [{ ...off.lightRows[0], include: true }], projects)
  assert.equal(on.lightRows[0].sessionName, 'Night 12')
  assert.equal(validateProposal(on, projects).size, 0)
})
