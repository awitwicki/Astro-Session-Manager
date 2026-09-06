#!/usr/bin/env node
// Generates public/catalogs/stars.json from the HYG star database v4.1
// (github.com/astronexus/HYG-Database, CC-BY-SA-4.0): every star with a
// Hipparcos, Henry Draper or Harvard Revised number, plus Bayer/Flamsteed,
// variable-star and IAU proper names.
// Run manually when updating the catalog: node scripts/generate-star-catalog.mjs
// Downloads the CSV at generation time only — never at build or app runtime.
//
// Output rows (decoded by src/lib/starSearch.ts, 0 / "" mean absent):
//   [hip, hd, hr, bayer, flam, proper, variable, ra°, dec°, mag, con]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'catalogs', 'stars.json')

const KNOWN_BAYER = new Set([
  'Alp', 'Bet', 'Gam', 'Del', 'Eps', 'Zet', 'Eta', 'The', 'Iot', 'Kap', 'Lam', 'Mu',
  'Nu', 'Xi', 'Omi', 'Pi', 'Rho', 'Sig', 'Tau', 'Ups', 'Phi', 'Chi', 'Psi', 'Ome',
])

function splitCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

const int = (s) => (s === '' ? 0 : Number(s))

const res = await fetch(URL)
if (!res.ok) throw new Error(`HYG download failed: HTTP ${res.status}`)
const lines = (await res.text()).split('\n')
const header = splitCsvLine(lines[0])
const col = Object.fromEntries(
  ['id', 'hip', 'hd', 'hr', 'bayer', 'flam', 'proper', 'var', 'ra', 'dec', 'mag', 'con', 'dist']
    .map((name) => [name, header.indexOf(name)]),
)
for (const [name, i] of Object.entries(col)) if (i < 0) throw new Error(`column ${name} missing`)

const rows = []
const unknownBayer = new Set()
for (const line of lines.slice(1)) {
  if (!line.trim()) continue
  const f = splitCsvLine(line)
  const hip = int(f[col.hip])
  const hd = int(f[col.hd])
  const hr = int(f[col.hr])
  if (!hip && !hd && !hr) continue // Gliese-only nearby stars, the Sun
  const ra = Number(f[col.ra]) * 15 // HYG stores hours
  const dec = Number(f[col.dec])
  const mag = Number(f[col.mag])
  if (![ra, dec, mag].every(Number.isFinite)) continue
  const bayer = f[col.bayer]
  if (bayer && !KNOWN_BAYER.has(bayer.split('-')[0])) unknownBayer.add(bayer)
  const flam = int(f[col.flam])
  if (!Number.isInteger(flam)) throw new Error(`non-integer Flamsteed number: ${f[col.flam]}`)
  rows.push([
    hip, hd, hr, bayer, flam, f[col.proper], f[col.var],
    Number(ra.toFixed(4)), Number(dec.toFixed(4)), Number(mag.toFixed(2)), f[col.con],
  ])
}

// Self-validation: fail loudly rather than emit a broken catalog
const byHd = (n) => rows.find((r) => r[1] === n)
const vega = byHd(172167)
const sirius = byHd(48915)
if (rows.length < 110000) throw new Error(`only ${rows.length} stars parsed`)
if (!vega || vega[5] !== 'Vega' || vega[3] !== 'Alp' || vega[10] !== 'Lyr' || Math.abs(vega[7] - 279.2347) > 0.01) {
  throw new Error(`Vega check failed: ${JSON.stringify(vega)}`)
}
if (!sirius || sirius[5] !== 'Sirius' || sirius[9] > -1.4) throw new Error(`Sirius check failed: ${JSON.stringify(sirius)}`)
if (!rows.some((r) => r[6] === 'RR' && r[10] === 'Lyr')) throw new Error('RR Lyr check failed')
if (rows.some((r) => r[5] === 'Sol')) throw new Error('the Sun slipped through')
if (unknownBayer.size > 0) throw new Error(`unknown Bayer abbreviations: ${[...unknownBayer].join(', ')}`)

mkdirSync(dirname(OUT), { recursive: true })
const json = JSON.stringify(rows)
writeFileSync(OUT, json)
console.log(`wrote ${rows.length} stars to ${OUT} (${(json.length / 1024 / 1024).toFixed(2)} MB)`)
console.log(`  with HD ${rows.filter((r) => r[1]).length}, HIP ${rows.filter((r) => r[0]).length}, HR ${rows.filter((r) => r[2]).length}, `
  + `proper names ${rows.filter((r) => r[5]).length}, Bayer ${rows.filter((r) => r[3]).length}, `
  + `Flamsteed ${rows.filter((r) => r[4]).length}, variable ${rows.filter((r) => r[6]).length}`)
