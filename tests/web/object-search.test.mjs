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
