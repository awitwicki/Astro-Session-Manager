import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStarIndex, decodeStarRows, searchStars, starDesignation, starDisplayName,
} from '../../src/lib/starSearch.ts'

const star = (o) => ({
  hip: null, hd: null, hr: null, bayer: null, flam: null, proper: null, variable: null,
  ra: 0, dec: 0, mag: 5, con: 'And', ...o,
})
const VEGA = star({ hip: 91262, hd: 172167, hr: 7001, bayer: 'Alp', flam: 3, proper: 'Vega', ra: 279.2346, dec: 38.7837, mag: 0.03, con: 'Lyr' })
const SIRIUS = star({ hip: 32349, hd: 48915, hr: 2491, bayer: 'Alp', flam: 9, proper: 'Sirius', ra: 101.2872, dec: -16.7161, mag: -1.44, con: 'CMa' })
const KAP1SCL = star({ hip: 1170, hd: 493, hr: 24, bayer: 'Kap-1', ra: 3.6, dec: -27.98, mag: 5.42, con: 'Scl' })
const CYG61 = star({ hip: 104214, hd: 201091, hr: 8085, flam: 61, ra: 316.72, dec: 38.74, mag: 5.2, con: 'Cyg' })
const RRLYR = star({ hip: 95497, hd: 182989, variable: 'RR', ra: 291.37, dec: 42.78, mag: 7.2, con: 'Lyr' })
const HIPONLY = star({ hip: 12345, ra: 10, dec: 10, mag: 9.1, con: 'Cet' })
const HD1 = star({ hip: 1, hd: 1, ra: 0.0, dec: 1.0, mag: 9.1 })
const HD10 = star({ hip: 10, hd: 10, ra: 0.1, dec: 1.1, mag: 8.0 })
const BARNARD = star({ hip: 87937, proper: "Barnard's Star", ra: 269.45, dec: 4.69, mag: 9.54, con: 'Oph' })
const index = buildStarIndex([VEGA, SIRIUS, KAP1SCL, CYG61, RRLYR, HIPONLY, HD1, HD10, BARNARD])

test('decodeStarRows turns compact rows into objects, blanks become null', () => {
  const [v] = decodeStarRows([[91262, 172167, 7001, 'Alp', 3, 'Vega', '', 279.2346, 38.7837, 0.03, 'Lyr']])
  assert.deepEqual(v, VEGA)
  const [h] = decodeStarRows([[12345, 0, 0, '', 0, '', '', 10, 10, 9.1, 'Cet']])
  assert.deepEqual(h, HIPONLY)
})

test('starDesignation prefers HD, then HIP, then HR', () => {
  assert.equal(starDesignation(VEGA), 'HD 172167')
  assert.equal(starDesignation(HIPONLY), 'HIP 12345')
  assert.equal(starDesignation(star({ hr: 7 })), 'HR 7')
})

test('starDisplayName: proper name, else Greek Bayer, else Flamsteed, else variable, else designation', () => {
  assert.equal(starDisplayName(VEGA), 'Vega')
  assert.equal(starDisplayName(KAP1SCL), 'κ¹ Scl')
  assert.equal(starDisplayName(CYG61), '61 Cyg')
  assert.equal(starDisplayName(RRLYR), 'RR Lyr')
  assert.equal(starDisplayName(HIPONLY), 'HIP 12345')
})

test('catalog numbers resolve exactly regardless of spacing and case', () => {
  for (const q of ['HD 172167', 'hd172167', 'Hd  172167']) assert.equal(searchStars(index, q)[0], VEGA, q)
  assert.equal(searchStars(index, 'hip 32349')[0], SIRIUS)
  assert.equal(searchStars(index, 'HR 8085')[0], CYG61)
})

test('a numeric prefix lists matching numbers with the exact number first', () => {
  const r = searchStars(index, 'hd 1')
  assert.equal(r[0], HD1)
  assert.ok(r.includes(HD10))
  assert.ok(r.includes(VEGA)) // HD 172167
  assert.ok(!r.includes(SIRIUS))
  assert.ok(!r.includes(HIPONLY))
})

test('proper names match by prefix before substring, spaces and apostrophes tolerated', () => {
  assert.equal(searchStars(index, 'veg')[0], VEGA)
  assert.equal(searchStars(index, 'irius')[0], SIRIUS)
  assert.equal(searchStars(index, 'barnard')[0], BARNARD)
  assert.equal(searchStars(index, "barnard's star")[0], BARNARD)
})

test('Bayer designations accept abbreviations, full Greek names and Greek letters', () => {
  for (const q of ['alp lyr', 'alpha lyr', 'α Lyr', 'Alp Lyr', 'alplyr'])
    assert.equal(searchStars(index, q)[0], VEGA, q)
  for (const q of ['kap1 scl', 'kappa1 scl', 'κ¹ Scl', 'kap-1 scl', 'kappa-1 scl'])
    assert.equal(searchStars(index, q)[0], KAP1SCL, q)
})

test('a Bayer letter alone lists every star with that letter, brightest first', () => {
  assert.deepEqual(searchStars(index, 'alp').slice(0, 2), [SIRIUS, VEGA])
  assert.deepEqual(searchStars(index, 'alpha').slice(0, 2), [SIRIUS, VEGA])
})

test('Flamsteed and variable-star designations resolve', () => {
  assert.equal(searchStars(index, '61 cyg')[0], CYG61)
  assert.equal(searchStars(index, '3 lyr')[0], VEGA)
  assert.equal(searchStars(index, 'RR Lyr')[0], RRLYR)
})

test('empty and unknown queries return nothing; limit caps results', () => {
  assert.deepEqual(searchStars(index, ''), [])
  assert.deepEqual(searchStars(index, '   '), [])
  assert.deepEqual(searchStars(index, 'xyzzy'), [])
  assert.equal(searchStars(index, 'hd', 3).length, 3)
})
