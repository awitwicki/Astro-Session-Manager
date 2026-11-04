import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchIndex } from '../../src/lib/catalogSearch.ts'
import { buildStarIndex } from '../../src/lib/starSearch.ts'
import { searchObjects } from '../../src/lib/objectSearch.ts'

const M31 = { id: 'NGC 224', m: 31, c: null, names: ['Andromeda Galaxy'], type: 'Galaxy', ra: 10.68, dec: 41.27, mag: 3.44, size: [177.8, 69.7], con: 'And' }
const HD1 = { id: 'HD 1', m: null, c: null, names: [], type: 'Galaxy', ra: 0, dec: 0, mag: null, size: null, con: 'And' } // fictional DSO named like a star
const dso = buildSearchIndex([M31, HD1])

const star = (o) => ({
  hip: null, hd: null, hr: null, bayer: null, flam: null, proper: null, variable: null,
  ra: 0, dec: 0, mag: 5, con: 'And', ...o,
})
const VEGA = star({ hip: 91262, hd: 172167, hr: 7001, bayer: 'Alp', flam: 3, proper: 'Vega', mag: 0.03, con: 'Lyr' })
const MIRACH = star({ hip: 5447, hd: 6860, bayer: 'Bet', proper: 'Mirach', mag: 2.07, con: 'And' })
const stars = buildStarIndex([VEGA, MIRACH])

test('results carry their kind and an exact DSO match comes first', () => {
  const r = searchObjects(dso, stars, 'm31')
  assert.equal(r.length, 1)
  assert.deepEqual(r[0], { kind: 'dso', obj: M31 })
})

test('a star query returns the star', () => {
  assert.deepEqual(searchObjects(dso, stars, 'vega'), [{ kind: 'star', star: VEGA }])
})

test('exact hits from both catalogs precede prefix hits, ties broken by magnitude', () => {
  const r = searchObjects(dso, stars, 'hd 1')
  assert.deepEqual(r[0], { kind: 'dso', obj: HD1 }) // exact designation, score 0
  assert.deepEqual(r[1], { kind: 'star', star: VEGA }) // HD 172167 prefix hit
})

test('a missing catalog is skipped rather than failing the search', () => {
  assert.deepEqual(searchObjects(null, stars, 'mirach'), [{ kind: 'star', star: MIRACH }])
  assert.deepEqual(searchObjects(dso, null, 'm31'), [{ kind: 'dso', obj: M31 }])
  assert.deepEqual(searchObjects(null, null, 'm31'), [])
})

test('limit caps the merged list', () => {
  const many = Array.from({ length: 30 }, (_, i) => star({ hip: 1000 + i, hd: 1000 + i, mag: i }))
  assert.equal(searchObjects(dso, buildStarIndex(many), 'hd 1', 5).length, 5)
})

// MPC elements (see orbits.test.mjs).
const VESTA_EL = { epochJd: 2461000.5, q: 2.3615413 * (1 - 0.0901676), e: 0.0901676, i: 7.14406, node: 103.70232, peri: 151.53712, meanAnomalyDeg: 26.80968, H: 3.25, G: 0.15 }
const A3_EL = { epochJd: 2460581.3396, q: 0.391298, e: 1.000182, i: 139.0983, node: 21.6807, peri: 308.5876, H: 6.5, G: 3.2 }
const a3 = { kind: 'comet', designation: 'C/2023 A3', name: 'Tsuchinshan-ATLAS', elements: A3_EL }
const vesta = { kind: 'asteroid', designation: '(4) Vesta', name: 'Vesta', elements: VESTA_EL }
const halley = { kind: 'comet', designation: '1P', name: 'Halley', elements: A3_EL }

test('planets match by prefix and rank like proper names', () => {
  const hits = searchObjects(null, null, 'ma')
  assert.ok(hits.some((h) => h.kind === 'planet' && h.body === 'Mars'))
  assert.ok(!hits.some((h) => h.kind === 'planet' && h.body === 'Venus'))
  // a planet name prefix ranks with star proper-name prefixes (tier 2), ahead of nothing exact
  const r = searchObjects(null, stars, 'mars')
  assert.deepEqual(r[0], { kind: 'planet', body: 'Mars' })
})

test('"moon" finds the Moon', () => {
  assert.deepEqual(searchObjects(null, null, 'moon'), [{ kind: 'planet', body: 'Moon' }])
  assert.deepEqual(searchObjects(null, null, 'MOON')[0], { kind: 'planet', body: 'Moon' })
})

test('minor bodies match designation, bare designation and name', () => {
  const extra = { minorBodies: [a3, vesta] }
  for (const q of ['C/2023 A3', '2023 A3', 'tsuchin']) {
    assert.equal(searchObjects(null, null, q, 20, extra)[0].body, a3, q)
  }
  for (const q of ['4 Vesta', 'Vesta', '(4)']) {
    assert.equal(searchObjects(null, null, q, 20, extra)[0].body, vesta, q)
  }
  assert.equal(searchObjects(null, null, 'atlas', 20, extra)[0].body, a3) // substring of the name
})

test('numbered periodic comets match designation and name', () => {
  const extra = { minorBodies: [a3, halley] }
  assert.equal(searchObjects(null, null, '1P', 20, extra)[0].body, halley)
  assert.equal(searchObjects(null, null, 'halley', 20, extra)[0].body, halley)
})

test('minor bodies are skipped without the extra source and never match an empty query', () => {
  assert.equal(searchObjects(null, null, 'vesta').length, 0)
  assert.equal(searchObjects(null, null, '', 20, { minorBodies: [a3, vesta] }).length, 0)
  assert.equal(searchObjects(null, null, '   ', 20, { minorBodies: [a3, vesta] }).length, 0)
})
