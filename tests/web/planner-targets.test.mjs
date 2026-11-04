import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  refreshMinorTargets, targetFromCoords, targetFromDso, targetFromHit, targetFromMinorBody, targetFromPlanet, targetFromStar,
} from '../../src/lib/plannerTargets.ts'

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

test('refreshMinorTargets swaps elements on matching designation and kind only', () => {
  const el = (a) => ({ a })
  const mk = (id, mover) => ({ id, designation: id, mover })
  const targets = [
    mk('C/2023 A3', { kind: 'comet', elements: el(1) }),
    mk('433', { kind: 'asteroid', elements: el(2) }),
    mk('433', { kind: 'comet', elements: el(3) }),
    mk('Mars', { kind: 'planet', body: 'Mars' }),
    mk('NGC 7000', undefined),
  ]
  const bodies = [
    { kind: 'comet', designation: 'C/2023 A3', name: 'x', elements: el(10) },
    { kind: 'asteroid', designation: '433', name: 'Eros', elements: el(20) },
  ]
  const out = refreshMinorTargets(targets, bodies)
  assert.deepEqual(out[0].mover, { kind: 'comet', elements: el(10) })
  assert.deepEqual(out[1].mover, { kind: 'asteroid', elements: el(20) })
  assert.deepEqual(out[2].mover, { kind: 'comet', elements: el(3) })
  assert.equal(out[3], targets[3])
  assert.equal(out[4], targets[4])
  assert.equal(refreshMinorTargets(targets, []), targets)
})

function near(a, b, tol) {
  assert.ok(Math.abs(a - b) < tol, `${a} vs ${b} (tol ${tol})`)
}

const A3_EL = { epochJd: 2460581.3396, q: 0.391298, e: 1.000182, i: 139.0983, node: 21.6807, peri: 308.5876, H: 6.5, G: 3.2 }
const VESTA_EL = { epochJd: 2461000.5, q: 2.3615413 * (1 - 0.0901676), e: 0.0901676, i: 7.14406, node: 103.70232, peri: 151.53712, meanAnomalyDeg: 26.80968, H: 3.25, G: 0.15 }
const a3 = { kind: 'comet', designation: 'C/2023 A3', name: 'Tsuchinshan-ATLAS', elements: A3_EL }
const vesta = { kind: 'asteroid', designation: '(4) Vesta', name: 'Vesta', elements: VESTA_EL }
const D = new Date('2026-11-04T00:00:00Z')

test('targetFromMinorBody / targetFromHit', () => {
  const t = targetFromMinorBody(a3, D)
  assert.equal(t.id, 'C/2023 A3')
  assert.equal(t.designation, 'C/2023 A3')
  assert.equal(t.name, 'Tsuchinshan-ATLAS')
  assert.equal(t.type, 'Comet')
  assert.equal(t.mover.kind, 'comet')
  assert.equal(t.mover.elements, A3_EL)
  assert.equal(t.addedAt, D.toISOString())
  near(t.mag, 18.97, 0.3)

  const v = targetFromMinorBody(vesta, D)
  assert.equal(v.id, '(4) Vesta')
  assert.equal(v.type, 'Asteroid')
  assert.equal(v.mover.kind, 'asteroid')
  assert.ok(Number.isFinite(v.mag) && v.mag > 5 && v.mag < 9, `Vesta mag ${v.mag}`)

  assert.deepEqual(targetFromHit({ kind: 'minor', body: a3 }, D), t)
  assert.deepEqual(targetFromHit({ kind: 'planet', body: 'Mars' }, D), targetFromPlanet('Mars', D))
  const vega = { hip: 91262, hd: 172167, hr: 7001, bayer: 'Alp', flam: 3, proper: 'Vega', variable: null, ra: 279.2346, dec: 38.7837, mag: 0.03, con: 'Lyr' }
  assert.deepEqual(targetFromHit({ kind: 'star', star: vega }, D), targetFromStar(vega, D))
  const obj = { id: 'NGC 7000', m: null, c: 20, names: ['North America Nebula'], type: 'Emission Nebula', ra: 314.82, dec: 44.53, mag: 4, size: [120, 30], con: 'Cyg' }
  assert.deepEqual(targetFromHit({ kind: 'dso', obj }, D), targetFromDso(obj, D))
})
