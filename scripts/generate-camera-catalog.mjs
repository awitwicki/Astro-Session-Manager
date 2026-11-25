#!/usr/bin/env node
// Generates public/catalogs/cameras.json from the AstroSubCalc camera
// database (astrodes.com/misc/astrosubcalc/), used with its author's
// permission: the data, not the calculator's code or styling.
// Downloads the JSON files at generation time only — never at build or app
// runtime. Run manually when updating the catalog:
//   node scripts/generate-camera-catalog.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://astrodes.com/misc/astrosubcalc/'
const ROOT = 'cameras.json'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'catalogs', 'cameras.json')
const USER_AGENT = 'Mozilla/5.0 (compatible; astro-session-manager-catalog-generator)'

const VENDOR_BY_FILE = {
  'zwo_asi_cameras.json': 'ZWO',
  'dslr_cameras.json': 'DSLR',
  'touptek_cameras.json': 'ToupTek',
  'svbony-cameras.json': 'Svbony',
  'atik-cameras.json': 'Atik',
  'qhy_cameras.json': 'QHY',
  'qhy_legacy_cameras.json': 'QHY',
  'fli_cameras_discontinued-v2.json': 'FLI',
}

async function fetchJson(filePath) {
  const res = await fetch(BASE + filePath, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${filePath}`)
  return res.json()
}

function fail(rowId, message) {
  console.error(`[generate-camera-catalog] ${message}${rowId ? ` (row: ${rowId})` : ''}`)
  process.exit(1)
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

function isPositive(v) {
  return isFiniteNumber(v) && v > 0
}

function validateRow(row) {
  const id = typeof row?.id === 'string' ? row.id : '<unknown id>'
  if (typeof row.id !== 'string' || row.id.trim() === '') fail(id, 'missing or empty id')
  if (typeof row.name !== 'string' || row.name.trim() === '') fail(id, 'missing or empty name')
  if (typeof row.sensor !== 'string' || row.sensor.trim() === '') fail(id, 'missing or empty sensor')
  if (row.type !== 'color' && row.type !== 'mono') fail(id, `type must be 'color' or 'mono', got ${row.type}`)
  for (const key of ['pixelSize', 'qe', 'readNoise', 'darkCurrentRef', 'darkDoublingTemp', 'fullWell', 'bitDepth', 'resolutionX', 'resolutionY']) {
    if (!isPositive(row[key])) fail(id, `${key} must be a finite number > 0, got ${row[key]}`)
  }
  for (const key of ['gain', 'darkRefTemp']) {
    if (!isFiniteNumber(row[key])) fail(id, `${key} must be a finite number, got ${row[key]}`)
  }
  if (row.maxCooling !== undefined && !isPositive(row.maxCooling)) {
    fail(id, `maxCooling must be a finite number > 0 when present, got ${row.maxCooling}`)
  }
}

/** Splits "ZWO ASI2600MC Pro (Gain 100 HGC)" into model + mode label.
 *  No parentheses -> label "Default". */
function splitNameAndLabel(name) {
  const idx = name.lastIndexOf(' (')
  if (idx === -1 || !name.endsWith(')')) return { model: name.trim(), label: 'Default' }
  return { model: name.slice(0, idx).trim(), label: name.slice(idx + 2, -1).trim() }
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function resolveEntries(entries, visited) {
  const rows = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const filePath = entry.trim()
      if (!filePath || visited.has(filePath)) continue
      visited.add(filePath)
      const sub = await fetchJson(filePath)
      if (!Array.isArray(sub)) fail(null, `${filePath} does not contain an array`)
      rows.push(...(await resolveEntries(sub, visited)).map((r) => ({ ...r, __sourceFile: r.__sourceFile ?? filePath })))
    } else if (entry && typeof entry === 'object') {
      rows.push({ ...entry })
    }
  }
  return rows
}

async function main() {
  const root = await fetchJson(ROOT)
  if (!Array.isArray(root)) fail(null, 'root cameras.json is not an array')

  const visited = new Set([ROOT])
  const rawRows = await resolveEntries(root, visited)

  for (const row of rawRows) validateRow(row)

  const byModel = new Map()
  for (const row of rawRows) {
    validateRow(row)
    const { model, label } = splitNameAndLabel(row.name)
    const vendor = VENDOR_BY_FILE[row.__sourceFile] ?? 'Other'

    const mode = {
      id: row.id,
      label,
      gain: row.gain,
      readNoise: row.readNoise,
      fullWell: row.fullWell,
    }

    const existing = byModel.get(model)
    if (!existing) {
      byModel.set(model, {
        id: slugify(model),
        model,
        vendor,
        sensor: row.sensor,
        mono: row.type === 'mono',
        pixelSize: row.pixelSize,
        qe: row.qe,
        bitDepth: row.bitDepth,
        resolutionX: row.resolutionX,
        resolutionY: row.resolutionY,
        maxCooling: row.maxCooling ?? null,
        darkRef: row.darkCurrentRef,
        darkRefTemp: row.darkRefTemp,
        darkDoubling: row.darkDoublingTemp,
        modes: [mode],
      })
    } else {
      if (existing.mono !== (row.type === 'mono') || existing.pixelSize !== row.pixelSize || existing.bitDepth !== row.bitDepth) {
        fail(row.id, `camera "${model}" has disagreeing type/pixelSize/bitDepth across its modes`)
      }
      existing.modes.push(mode)
    }
  }

  const cameras = [...byModel.values()]
  for (const c of cameras) c.modes.sort((a, b) => a.gain - b.gain)
  cameras.sort((a, b) => a.vendor.localeCompare(b.vendor) || a.model.localeCompare(b.model))

  // De-duplicate ids across models (slugify can collide on punctuation-only differences).
  const seenIds = new Map()
  for (const c of cameras) {
    const count = (seenIds.get(c.id) ?? 0) + 1
    seenIds.set(c.id, count)
    if (count > 1) c.id = `${c.id}-${count}`
  }

  const out = {
    source: BASE,
    generated: new Date().toISOString(),
    cameras,
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)

  const totalModes = cameras.reduce((n, c) => n + c.modes.length, 0)
  console.log(`[generate-camera-catalog] wrote ${cameras.length} camera models, ${totalModes} modes -> ${OUT}`)
}

main().catch((err) => {
  console.error('[generate-camera-catalog] failed:', err)
  process.exit(1)
})
