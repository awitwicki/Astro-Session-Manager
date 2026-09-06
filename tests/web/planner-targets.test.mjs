import { test } from 'node:test'
import assert from 'node:assert/strict'
import { targetFromCoords, targetFromDso, targetFromStar } from '../../src/lib/plannerTargets.ts'

const NOW = new Date('2026-09-06T20:00:00Z')

test('targetFromDso maps a catalog object, first common name as display name', () => {
  const obj = { id: 'NGC 7000', m: null, c: 20, names: ['North America Nebula'], type: 'Emission Nebula', ra: 314.82, dec: 44.53, mag: 4, size: [120, 30], con: 'Cyg' }
  assert.deepEqual(targetFromDso(obj, NOW), {
    id: 'NGC 7000', name: 'North America Nebula', designation: 'NGC 7000', messier: null,
    ra: 314.82, dec: 44.53, type: 'Emission Nebula', mag: 4, sizeArcmin: [120, 30],
    constellation: 'Cyg', addedAt: NOW.toISOString(),
  })
  const bare = { ...obj, id: 'NGC 1', names: [], m: 1 }
  assert.equal(targetFromDso(bare, NOW).name, 'NGC 1')
  assert.equal(targetFromDso(bare, NOW).messier, 1)
})

test('targetFromStar uses the catalog designation as id and the display name', () => {
  const vega = { hip: 91262, hd: 172167, hr: 7001, bayer: 'Alp', flam: 3, proper: 'Vega', variable: null, ra: 279.2346, dec: 38.7837, mag: 0.03, con: 'Lyr' }
  assert.deepEqual(targetFromStar(vega, NOW), {
    id: 'HD 172167', name: 'Vega', designation: 'HD 172167', messier: null,
    ra: 279.2346, dec: 38.7837, type: 'Star', mag: 0.03, sizeArcmin: null,
    constellation: 'Lyr', addedAt: NOW.toISOString(),
  })
  const unnamed = { ...vega, hd: null, hr: null, proper: null, bayer: null, flam: null }
  assert.equal(targetFromStar(unnamed, NOW).id, 'HIP 91262')
  assert.equal(targetFromStar(unnamed, NOW).name, 'HIP 91262')
})

test('targetFromCoords builds a custom target with formatted coordinates as designation', () => {
  const t = targetFromCoords('My spot', 187.5, 41.27, NOW)
  assert.equal(t.id, `custom-${NOW.getTime()}`)
  assert.equal(t.name, 'My spot')
  assert.equal(t.designation, `12h 30m 00s +41° 16' 12"`)
  assert.equal(t.type, 'Custom')
  assert.equal(t.mag, null)
  assert.equal(t.sizeArcmin, null)
  assert.equal(t.constellation, '')
  assert.equal(t.messier, null)
  assert.equal(t.ra, 187.5)
  assert.equal(t.dec, 41.27)
})

test('targetFromCoords falls back to the coordinates as name when the name is blank', () => {
  const t = targetFromCoords('   ', 0, -5.5, NOW)
  assert.equal(t.name, `00h 00m 00s -05° 30' 00"`)
})
