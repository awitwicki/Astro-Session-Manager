#!/usr/bin/env node
// Generates public/catalogs/dso.json from the OpenNGC database
// (github.com/mattiaverga/OpenNGC, CC-BY-SA-4.0).
// Run manually when updating the catalog: node scripts/generate-dso-catalog.mjs
// Downloads the CSVs at generation time only — never at build or app runtime.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'catalogs', 'dso.json')

// Column indices in the OpenNGC CSV (semicolon-delimited)
const COL = { name: 0, type: 1, ra: 2, dec: 3, con: 4, majAx: 5, minAx: 6, bMag: 8, vMag: 9, m: 23, identifiers: 27, commonNames: 28 }

const TYPE_LABELS = {
  'G': 'Galaxy', 'GPair': 'Galaxy Pair', 'GTrpl': 'Galaxy Triplet', 'GGroup': 'Galaxy Group',
  'OCl': 'Open Cluster', 'GCl': 'Globular Cluster', 'Cl+N': 'Cluster + Nebula',
  'PN': 'Planetary Nebula', 'HII': 'Emission Nebula', 'EmN': 'Emission Nebula',
  'Neb': 'Nebula', 'RfN': 'Reflection Nebula', 'SNR': 'Supernova Remnant',
  'DrkN': 'Dark Nebula', 'Nova': 'Nova', '*': 'Star', '**': 'Double Star', '*Ass': 'Asterism',
}

function parseHMS(s) { // "00:42:44.35" -> degrees
  const [h, m, sec] = s.split(':').map(Number)
  if ([h, m, sec].some(Number.isNaN)) return null
  return (h + m / 60 + sec / 3600) * 15
}

function parseDMS(s) { // "+41:16:08.6" -> degrees
  const sign = s.startsWith('-') ? -1 : 1
  const [d, m, sec] = s.replace(/^[+-]/, '').split(':').map(Number)
  if ([d, m, sec].some(Number.isNaN)) return null
  return sign * (d + m / 60 + sec / 3600)
}

function designation(rawName) { // "NGC0224" -> "NGC 224", "Mel022" -> "Mel 22"
  const m = rawName.match(/^([A-Za-z+]+)0*(\d+)(.*)$/)
  if (!m) return rawName
  return `${m[1]} ${m[2]}${m[3]}`
}

function caldwellFrom(identifiers, rawName) {
  const cName = rawName.match(/^C0*(\d+)$/) // addendum rows named C009 etc.
  if (cName) return Number(cName[1])
  const m = identifiers.match(/(?:^|,)C 0*(\d+)(?:,|$)/)
  return m ? Number(m[1]) : null
}

function parseCsv(text, { addendum }) {
  const out = []
  for (const line of text.split('\n').slice(1)) {
    if (!line.trim()) continue
    const f = line.split(';')
    const type = f[COL.type]
    if (type === 'Dup' || type === 'NonEx' || type === 'Other') continue
    const ra = parseHMS(f[COL.ra] ?? '')
    const dec = parseDMS(f[COL.dec] ?? '')
    if (ra === null || dec === null) continue
    const mNum = f[COL.m] ? Number(f[COL.m]) : null
    const c = caldwellFrom(f[COL.identifiers] ?? '', f[COL.name])
    const names = (f[COL.commonNames] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    // The addendum holds non-NGC/IC objects; keep only notable ones
    if (addendum && mNum === null && c === null && names.length === 0) continue
    const vMag = f[COL.vMag] ? Number(f[COL.vMag]) : NaN
    const bMag = f[COL.bMag] ? Number(f[COL.bMag]) : NaN
    const majAx = f[COL.majAx] ? Number(f[COL.majAx]) : NaN
    const minAx = f[COL.minAx] ? Number(f[COL.minAx]) : NaN
    out.push({
      id: designation(f[COL.name]),
      m: mNum !== null && !Number.isNaN(mNum) ? mNum : null,
      c,
      names,
      type: TYPE_LABELS[type] ?? type,
      ra: Number(ra.toFixed(5)),
      dec: Number(dec.toFixed(5)),
      mag: !Number.isNaN(vMag) ? vMag : !Number.isNaN(bMag) ? bMag : null,
      size: !Number.isNaN(majAx) ? [majAx, !Number.isNaN(minAx) ? minAx : majAx] : null,
      con: f[COL.con] ?? '',
    })
  }
  return out
}

async function fetchCsv(file) {
  const res = await fetch(`${BASE}/${file}`)
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
  return res.text()
}

const ngc = parseCsv(await fetchCsv('NGC.csv'), { addendum: false })
const add = parseCsv(await fetchCsv('addendum.csv'), { addendum: true })
const all = [...ngc, ...add].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))

// Self-validation: fail loudly rather than emit a broken catalog
const m31 = all.find((o) => o.m === 31)
const n7000 = all.find((o) => o.id === 'NGC 7000')
if (all.length < 12000) throw new Error(`only ${all.length} objects parsed`)
if (!m31 || m31.id !== 'NGC 224' || Math.abs(m31.ra - 10.6848) > 0.01) throw new Error('M31 check failed')
if (!n7000 || n7000.c !== 20 || !n7000.names.includes('North America Nebula')) throw new Error('NGC 7000 check failed')
if (!all.some((o) => o.m === 45)) throw new Error('M45 (Pleiades, addendum) check failed')

mkdirSync(dirname(OUT), { recursive: true })
const json = JSON.stringify(all)
writeFileSync(OUT, json)
console.log(`wrote ${all.length} objects to ${OUT} (${(json.length / 1024 / 1024).toFixed(2)} MB)`)
