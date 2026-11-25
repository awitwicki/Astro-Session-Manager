// Website version of the app's sub-exposure calculator
// (src/components/calculators/SubExposureCalculator.tsx). The model, the
// camera catalog, the chart geometry and the saved-state check are the app's
// own modules, generated into this folder by `yarn sync:subcalc`; this file is
// only the page around them. The website has no image library, so there is no
// "Your cameras" group: the page starts from a common camera instead.

import { BORTLE_ROWS } from './bortle.js'
import { parseCatalog, searchCameras, nearestMode } from './cameraCatalog.js'
import {
  FILTER_PRESETS, NOISE_OPTIONS, subExposure, sensorParams, defaultSensorTemp, formatSub, sweepByFocalRatio,
} from './subExposure.js'
import { subChart } from './subExposureChart.js'
import { restoreState, DEFAULT_STATE } from './userCameras.js'

const STORAGE_KEY = 'subcalc.state'
const START_CAMERA = 'zwo-asi2600mc-pro'
const START_FOCAL_RATIO = '5'
const FOCAL_RATIO_CHIPS = [2, 2.8, 4, 5, 5.6, 7, 10]
const MAX_COMPARE = 5
const SERIES_COLORS = [
  'var(--color-accent)', 'var(--color-success)', 'var(--color-warning)',
  'var(--color-error)', 'var(--color-text-secondary)', 'var(--color-text-muted)',
]
const SENSOR_FIELDS = [
  { key: 'pixelSize', label: 'Pixel size', unit: 'µm' },
  { key: 'qe', label: 'Quantum efficiency', unit: '%' },
  { key: 'readNoise', label: 'Read noise', unit: 'e⁻' },
  { key: 'fullWell', label: 'Full well', unit: 'e⁻' },
  { key: 'bitDepth', label: 'Bit depth', unit: '' },
  { key: 'darkRef', label: 'Dark current (ref. temp.)', unit: 'e⁻/px/s' },
]
const GLOVER_URL = 'https://forums.sharpcap.co.uk/viewtopic.php?p=29102'
const ASTRODES_URL = 'https://astrodes.com/misc/astrosubcalc/'

// ─── Helpers ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id)
const num = (s) => {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const trim = (n, digits) => String(Number(n.toFixed(digits)))
const formatNumber = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
// Sky and dark rates can be a few ten-thousandths of an electron.
const formatRate = (n) => (n === 0 ? '0' : Math.abs(n) >= 1 ? formatNumber(n) : String(Number(n.toPrecision(3))))
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function verdictCopy(result, extraNoisePct) {
  switch (result.verdict) {
    case 'ok': return `Longer subs lower the noise by less than ${trim(extraNoisePct, 0)} %.`
    case 'darkLimited': return 'Dark current outweighs the sky here. Cooling or faster optics would help more than longer subs.'
    case 'veryLong': return 'The sky is too faint to swamp the read noise in a practical sub. Shoot as long as tracking allows.'
    default: return `The background alone fills ${trim(result.skyFill * 100, 0)} % of the well. Use a shorter sub or a lower gain.`
  }
}

const heroTone = (result) => !result ? ''
  : result.verdict === 'darkLimited' ? 'fc-poor'
  : result.verdict === 'veryLong' || result.verdict === 'clipping' ? 'fc-fair' : ''

const blankSensor = () => ({
  mono: false, pixelSize: 0, qe: 0, readNoise: 0, fullWell: 0, bitDepth: 16, darkRef: 0, darkRefTemp: 0, darkDoubling: 6,
})

const cameraLabel = (camera, mode) => (camera.modes.length > 1 ? `${camera.model} (${mode.label})` : camera.model)

// ─── State ──────────────────────────────────────────────────────────────────

let catalog = []
let state = { ...DEFAULT_STATE }
let editingSensor = false
let showComparePicker = false
const pickers = {
  primary: { open: false, query: '', highlight: 0 },
  compare: { open: false, query: '', highlight: 0 },
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* private mode */ }
}

function selectedCamera() {
  return state.cameraId && state.cameraId !== 'custom' ? catalog.find((c) => c.id === state.cameraId) ?? null : null
}

function currentMode(camera) {
  return camera ? camera.modes.find((m) => m.id === state.modeId) ?? nearestMode(camera, undefined) : null
}

function currentOverrides() {
  return state.cameraId ? state.overridesByCamera[state.cameraId] ?? {} : {}
}

function baseSensor() {
  const camera = selectedCamera()
  return camera ? sensorParams(camera, currentMode(camera)) : blankSensor()
}

function effectiveSensor() {
  return { ...baseSensor(), ...currentOverrides() }
}

function selectCamera(id) {
  const camera = id === 'custom' ? null : catalog.find((c) => c.id === id) ?? null
  state = {
    ...state,
    cameraId: id,
    modeId: camera ? nearestMode(camera, undefined).id : null,
    sensorTemp: String(defaultSensorTemp(camera ?? { maxCooling: null })),
    // The telescope doesn't change with the camera: keep the focal ratio
    // unless one was typed for this camera before.
    focalRatio: state.focalRatioByCamera[id] ?? state.focalRatio,
  }
  editingSensor = false
  seedSensorFields()
}

function updateOverrides(updater) {
  if (!state.cameraId) return
  const key = state.cameraId
  state = { ...state, overridesByCamera: { ...state.overridesByCamera, [key]: updater(state.overridesByCamera[key] ?? {}) } }
}

// ─── Page skeleton (built once; only values and results change later) ───────

function field(id, label, unit, control, extraId = '') {
  return `<div class="calc-field"${extraId ? ` id="${extraId}"` : ''}>
    <label class="calc-field-label" for="${id}"><span id="${id}-label">${label}</span>${unit ? `<span class="fc-unit">${unit}</span>` : ''}</label>
    ${control}
  </div>`
}

function picker(which) {
  return `<div class="se-picker" data-picker="${which}">
    <input id="se-picker-${which}" class="calc-input se-picker-input" role="combobox" aria-expanded="false"
      aria-controls="se-list-${which}" aria-autocomplete="list" autocomplete="off" placeholder="Search camera or sensor…" />
    <ul class="se-picker-list" role="listbox" id="se-list-${which}" hidden></ul>
  </div>`
}

$('app').innerHTML = `
  <p class="calc-section-desc">
    The longest single sub that still pays off: once the sky's own shot noise swamps the
    camera's read noise, a longer sub only costs dynamic range and lost frames.
  </p>

  <div class="fc-inputs">
    <div class="calc-panel fc-card">
      <h2 class="fc-card-title">Camera</h2>
      <div class="calc-field">
        <label class="calc-field-label" for="se-picker-primary">Camera</label>
        ${picker('primary')}
      </div>
      ${field('se-mode', 'Mode', '', '<select id="se-mode" class="calc-select"></select>', 'se-mode-field')}
      ${field('se-sensor-temp', 'Sensor', '°C', '<input id="se-sensor-temp" data-key="sensorTemp" class="calc-input" type="number" step="any" />')}
      <p class="calc-hint se-summary" id="se-summary"></p>
      <div class="se-sensor-toggle" id="se-sensor-toggle">
        <button type="button" class="fc-link" id="se-edit-toggle"></button>
        <span class="se-edited" id="se-edited">edited · <button type="button" class="fc-link" id="se-reset">Reset</button></span>
      </div>
      <p class="calc-field-label" id="se-sensor-heading">Sensor values</p>
      <div class="fc-grid" id="se-sensor-grid">
        ${SENSOR_FIELDS.slice(0, 5).map((f) => field(`se-${f.key}`, f.label, f.unit,
          `<input id="se-${f.key}" data-sensor="${f.key}" class="calc-input" type="number" step="any" min="0" />`)).join('')}
        ${field('se-mono', 'Sensor colour', '', `<div class="calc-seg" role="group" aria-label="Mono or colour">
          <button type="button" class="calc-seg-btn" data-mono="1">Mono</button>
          <button type="button" class="calc-seg-btn" data-mono="0">Colour</button>
        </div>`)}
        ${field('se-darkRef', SENSOR_FIELDS[5].label, SENSOR_FIELDS[5].unit,
          '<input id="se-darkRef" data-sensor="darkRef" class="calc-input" type="number" step="any" min="0" />')}
      </div>
    </div>

    <div class="calc-panel fc-card">
      <h2 class="fc-card-title">Conditions</h2>
      <div class="se-switch-row">
        <div class="calc-field">
          <span class="calc-field-label">Sky</span>
          <div class="calc-seg" role="group" aria-label="Sky input mode">
            <button type="button" class="calc-seg-btn" data-sky="bortle">Bortle</button>
            <button type="button" class="calc-seg-btn" data-sky="sqm">SQM</button>
          </div>
        </div>
        <div class="calc-field">
          <span class="calc-field-label">Accepted extra noise</span>
          <div class="calc-seg" role="group" aria-label="Accepted extra noise">
            ${NOISE_OPTIONS.map((n) => `<button type="button" class="calc-seg-btn" data-noise="${n}">${trim(n * 100, 0)} %</button>`).join('')}
          </div>
        </div>
      </div>
      ${field('se-bortle', 'Bortle class', '', `<select id="se-bortle" class="calc-select">
        ${BORTLE_ROWS.map((r) => `<option value="${r.bortle}">${r.bortle} · ${r.sqm.toFixed(1)} mag/arcsec²</option>`).join('')}
      </select>`, 'se-bortle-field')}
      ${field('se-sqm', 'SQM', 'mag/arcsec²', '<input id="se-sqm" data-key="sqm" class="calc-input" type="number" step="0.1" />', 'se-sqm-field')}
      ${field('se-filter', 'Filter', '', `<select id="se-filter" class="calc-select">
        ${FILTER_PRESETS.map((f) => `<option value="${f.id}">${esc(f.label)} (${trim(f.share * 100, 1)} %)</option>`).join('')}
        <option value="custom">Custom…</option>
      </select>`)}
      ${field('se-filter-pct', 'Filter passes', '%', '<input id="se-filter-pct" data-key="customFilterPct" class="calc-input" type="number" step="any" min="0" max="100" />', 'se-filter-pct-field')}
      ${field('se-focal-ratio', 'Focal ratio', 'f/', '<input id="se-focal-ratio" data-key="focalRatio" class="calc-input" type="number" step="0.1" min="0" />')}
      <div class="fc-chips" role="group" aria-label="Common focal ratios">
        ${FOCAL_RATIO_CHIPS.map((v) => `<button type="button" class="fc-chip" data-ratio="${v}">f/${v}</button>`).join('')}
      </div>
    </div>
  </div>

  <div id="se-output"></div>

  <div class="calc-panel fc-card">
    <h2 class="fc-card-title">Sub length by focal ratio</h2>
    <p class="fc-caption">Same camera, sky and filter at every focal ratio. The dot is your telescope.</p>
    <div id="se-chart"></div>
  </div>

  <div class="calc-panel fc-card">
    <div class="fc-card-head">
      <h2 class="fc-card-title">Compare cameras</h2>
      <button type="button" class="btn" id="se-compare-add">+ Compare with another camera</button>
    </div>
    <div id="se-compare-picker" hidden>${picker('compare')}</div>
    <div id="se-compare-table"></div>
  </div>

  <div class="calc-panel fc-card fc-sources">
    <h2 class="fc-card-title">Method and credit</h2>
    <p class="fc-caption">
      The longest sub is t = C · RN² / (sky + dark): the Glover constant C set by the accepted
      extra noise, over the electrons a pixel collects each second from the sky background (from
      sky brightness, pixel size, focal ratio, quantum efficiency and the filter) and from dark
      current. Binning, optics transmission and the target itself are not modelled; catalog
      sensor values are typical for the model, not measured on your own unit — treat the result
      as a good estimate, not a measurement.
    </p>
    <ul class="fc-source-list">
      <li><b>astrodes.com</b> <a href="${ASTRODES_URL}">AstroSubCalc</a>
        <span>The camera database and the idea for this calculator, used with the author's permission.</span></li>
      <li><b>Robin Glover</b> <a href="${GLOVER_URL}">SharpCap forum, 2022</a>
        <span>The sub-exposure method, and the sky-rate estimate this model is checked against.</span></li>
    </ul>
  </div>`

// ─── Camera picker ──────────────────────────────────────────────────────────

function pickerOptions(which) {
  const p = pickers[which]
  const words = p.query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const options = searchCameras(catalog, p.query, 50).map((c) => ({ id: c.id, group: c.vendor, label: c.model }))
  // A custom camera has no catalog sensor to put in a comparison.
  if (which === 'primary' && words.every((w) => 'custom camera'.includes(w))) {
    options.push({ id: 'custom', group: '', label: 'Custom camera' })
  }
  return options
}

function renderPicker(which) {
  const p = pickers[which]
  const input = $(`se-picker-${which}`)
  const list = $(`se-list-${which}`)
  input.setAttribute('aria-expanded', String(p.open))
  list.hidden = !p.open
  if (!p.open) {
    if (which === 'primary') {
      input.value = state.cameraId === 'custom' ? 'Custom camera' : selectedCamera()?.model ?? ''
    } else {
      input.value = ''
    }
    return
  }
  const options = pickerOptions(which)
  let lastGroup = null
  list.innerHTML = options.length === 0 ? '<li class="se-picker-empty">No matches</li>' : options.map((o, i) => {
    const group = o.group !== lastGroup && o.group !== '' ? `<div class="se-picker-group">${esc(o.group)}</div>` : ''
    lastGroup = o.group
    return `<li>${group}<button type="button" role="option" aria-selected="${i === p.highlight}"
      class="se-picker-option ${i === p.highlight ? 'active' : ''}" data-pick="${esc(o.id)}" data-picker="${which}">
      <span>${esc(o.label)}</span></button></li>`
  }).join('')
}

function closePicker(which) {
  pickers[which] = { open: false, query: '', highlight: 0 }
  renderPicker(which)
}

function pick(which, id) {
  if (which === 'primary') {
    selectCamera(id)
  } else {
    const camera = catalog.find((c) => c.id === id)
    if (camera) {
      state = { ...state, compare: [...state.compare, { cameraId: id, modeId: nearestMode(camera, undefined).id }].slice(0, MAX_COMPARE) }
    }
    showComparePicker = false
  }
  closePicker(which)
  syncControls()
  render()
}

// ─── State → page ───────────────────────────────────────────────────────────

/** Write the sensor values into the editor (after a camera or mode change). */
function seedSensorFields() {
  const sensor = effectiveSensor()
  for (const f of SENSOR_FIELDS) $(`se-${f.key}`).value = sensor[f.key] ? String(sensor[f.key]) : ''
}

/** Write state into the controls (after a preset, a camera change, a restore). */
function syncControls() {
  for (const el of document.querySelectorAll('[data-key]')) {
    if (el.value !== state[el.dataset.key]) el.value = state[el.dataset.key]
  }
  $('se-bortle').value = String(state.bortle)
  $('se-filter').value = state.filterId
}

function conditions() {
  const row = BORTLE_ROWS.find((r) => r.bortle === state.bortle)
  const sqm = state.skyMode === 'bortle' ? row?.sqm ?? null : num(state.sqm)
  const focalRatio = num(state.focalRatio)
  const preset = FILTER_PRESETS.find((f) => f.id === state.filterId)
  const pct = num(state.customFilterPct)
  const filterShare = state.filterId === 'custom' ? (pct !== null ? pct / 100 : null) : preset?.share ?? null
  const sensorTemp = num(state.sensorTemp)
  if (sqm === null || focalRatio === null || filterShare === null || sensorTemp === null) return null
  return { sqm, focalRatio, filterShare, sensorTemp, extraNoise: state.extraNoise }
}

function chartSvg(chart) {
  const { plot } = chart
  return `<figure class="fc-figure">
    <svg viewBox="0 0 ${chart.width} ${chart.height}" class="fc-svg" role="img"
      aria-label="Recommended sub length against focal ratio, one line per camera">
      ${chart.yTicks.map((t) => `<line x1="${plot.x}" y1="${t.y}" x2="${plot.x + plot.w}" y2="${t.y}" class="fc-gridline" />
        <text x="${plot.x - 8}" y="${t.y + 3.5}" text-anchor="end">${t.label}</text>`).join('')}
      ${chart.xTicks.map((t) => `<line x1="${t.x}" y1="${plot.y + plot.h}" x2="${t.x}" y2="${plot.y + plot.h + 4}" class="fc-tick" />
        <text x="${t.x}" y="${plot.y + plot.h + 17}" text-anchor="middle">${t.label}</text>`).join('')}
      <line x1="${plot.x}" y1="${plot.y + plot.h}" x2="${plot.x + plot.w}" y2="${plot.y + plot.h}" class="fc-axis" />
      <text x="${plot.x + plot.w / 2}" y="${chart.height - 4}" text-anchor="middle" class="fc-axis-title">Focal ratio</text>
      ${chart.series.map((s, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length]
        if (!s.path) return ''
        return `<path d="${s.path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />
          ${s.marker ? `<circle cx="${s.marker.x}" cy="${s.marker.y}" r="4.5" fill="${color}" class="se-chart-marker" />` : ''}
          <text x="${plot.x + plot.w - 4}" y="${(s.marker ? s.marker.y : plot.y + plot.h) - 6}" text-anchor="end"
            style="fill: ${color}" class="fc-line-label">${esc(s.label)}</text>`
      }).join('')}
    </svg>
  </figure>`
}

function render() {
  const camera = selectedCamera()
  const mode = currentMode(camera)
  const sensor = effectiveSensor()
  const hasOverrides = Object.keys(currentOverrides()).length > 0
  const isCustom = !camera

  // Camera panel
  renderPicker('primary')
  $('se-mode-field').hidden = !camera || camera.modes.length < 2
  if (camera) {
    $('se-mode').innerHTML = camera.modes.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')
    $('se-mode').value = mode.id
  }
  $('se-sensor-temp-label').textContent = camera && camera.maxCooling !== null ? 'Sensor' : 'Air temperature'
  $('se-summary').hidden = !camera
  if (camera) {
    $('se-summary').textContent = `${camera.sensor} · ${sensor.mono ? 'mono' : 'colour'} · ${trim(sensor.pixelSize, 2)} µm`
      + ` · RN ${trim(sensor.readNoise, 2)} e⁻ · FW ${formatNumber(sensor.fullWell)} e⁻`
  }
  const fieldsOpen = isCustom || editingSensor
  $('se-sensor-toggle').hidden = isCustom
  $('se-edit-toggle').textContent = fieldsOpen ? 'Hide sensor values' : 'Edit sensor values'
  $('se-edited').hidden = !hasOverrides
  $('se-sensor-heading').hidden = !isCustom
  $('se-sensor-grid').hidden = !fieldsOpen
  for (const b of document.querySelectorAll('[data-mono]')) b.classList.toggle('active', (b.dataset.mono === '1') === sensor.mono)

  // Conditions panel
  for (const b of document.querySelectorAll('[data-sky]')) b.classList.toggle('active', b.dataset.sky === state.skyMode)
  $('se-bortle-field').hidden = state.skyMode !== 'bortle'
  $('se-sqm-field').hidden = state.skyMode !== 'sqm'
  $('se-filter-pct-field').hidden = state.filterId !== 'custom'
  for (const b of document.querySelectorAll('[data-ratio]')) b.classList.toggle('active', num(state.focalRatio) === Number(b.dataset.ratio))
  for (const b of document.querySelectorAll('[data-noise]')) b.classList.toggle('active', Number(b.dataset.noise) === state.extraNoise)

  // Result
  const cond = conditions()
  const result = cond ? subExposure(sensor, cond) : null
  const dash = '—'
  $('se-output').innerHTML = `
    <div class="fc-results">
      <div class="fc-hero ${heroTone(result)}">
        <div class="calc-result-label">Recommended sub exposure</div>
        <div class="fc-hero-row"><div class="fc-hero-value">${result ? formatSub(result.suggested) : dash}</div></div>
        <div class="fc-verdict">${result ? verdictCopy(result, state.extraNoise * 100) : ''}</div>
        <div class="calc-result-sub">${result ? `Read noise is swamped from ${formatSub(result.minSub)}` : ''}</div>
      </div>
      <div class="fc-stats">
        <div class="calc-result-card"><div class="calc-result-label">Sky</div>
          <div class="calc-result-value">${result ? `${formatRate(result.skyRate)} e⁻/px/s` : dash}</div></div>
        <div class="calc-result-card"><div class="calc-result-label">Dark</div>
          <div class="calc-result-value">${result ? `${formatRate(result.darkRate)} e⁻/px/s` : dash}</div></div>
        <div class="calc-result-card"><div class="calc-result-label">Sky fill</div>
          <div class="calc-result-value">${result ? `${trim(result.skyFill * 100, 1)} %` : dash}</div></div>
        <div class="calc-result-card"><div class="calc-result-label">Background clips after</div>
          <div class="calc-result-value">${result ? formatSub(result.clipTime) : dash}</div></div>
      </div>
    </div>`

  // Compare rows (catalog cameras only, under the same conditions)
  const rows = state.compare.flatMap((e) => {
    const c = catalog.find((x) => x.id === e.cameraId)
    const m = c?.modes.find((x) => x.id === e.modeId)
    if (!c || !m) return []
    const s = sensorParams(c, m)
    return [{ key: `${e.cameraId}:${e.modeId}`, camera: c, mode: m, sensor: s, result: cond ? subExposure(s, cond) : null }]
  })

  // Chart
  const primaryLabel = camera ? cameraLabel(camera, mode) : 'Custom camera'
  const series = cond ? [
    { id: 'primary', label: primaryLabel, points: sweepByFocalRatio(sensor, cond) },
    ...rows.map((r) => ({ id: r.key, label: cameraLabel(r.camera, r.mode), points: sweepByFocalRatio(r.sensor, cond) })),
  ] : []
  $('se-chart').innerHTML = chartSvg(subChart(series, num(state.focalRatio)))

  // Compare card
  $('se-compare-add').hidden = state.compare.length >= MAX_COMPARE
  $('se-compare-picker').hidden = !showComparePicker
  const cells = (r) => `
    <td class="calc-num">${r ? `${formatRate(r.skyRate)} e⁻/px/s` : dash}</td>
    <td class="calc-num">${r ? `${formatRate(r.darkRate)} e⁻/px/s` : dash}</td>
    <td class="calc-num">${r ? formatSub(r.suggested) : dash}</td>
    <td class="calc-num">${r ? `${trim(r.skyFill * 100, 1)} %` : dash}</td>`
  $('se-compare-table').innerHTML = rows.length === 0 ? '' : `
    <div class="calc-table-wrapper"><table class="calc-table">
      <thead><tr><th>Camera</th><th>Mode</th><th class="calc-num">Sky</th><th class="calc-num">Dark</th>
        <th class="calc-num">Sub</th><th class="calc-num">Sky fill</th><th></th></tr></thead>
      <tbody>
        <tr class="calc-row-active"><td>${esc(camera ? camera.model : 'Custom camera')}</td>
          <td>${camera && camera.modes.length > 1 ? esc(mode.label) : dash}</td>${cells(result)}<td></td></tr>
        ${rows.map((r, i) => `<tr><td>${esc(r.camera.model)}</td>
          <td>${r.camera.modes.length > 1 ? `<select class="calc-select" data-compare-mode="${i}">
            ${r.camera.modes.map((m) => `<option value="${esc(m.id)}"${m.id === r.mode.id ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
          </select>` : dash}</td>${cells(r.result)}
          <td><button type="button" class="fc-link" data-compare-remove="${i}" title="Remove">✕</button></td></tr>`).join('')}
      </tbody>
    </table></div>`

  save()
}

// ─── Events ─────────────────────────────────────────────────────────────────

document.addEventListener('focusin', (e) => {
  const which = e.target.closest?.('.se-picker')?.dataset.picker
  if (!which || !e.target.classList.contains('se-picker-input') || pickers[which].open) return
  pickers[which] = { open: true, query: '', highlight: 0 }
  e.target.value = '' // the input shows the search while open, like the app's
  renderPicker(which)
})

document.addEventListener('pointerdown', (e) => {
  for (const which of Object.keys(pickers)) {
    if (pickers[which].open && !e.target.closest?.(`[data-picker="${which}"]`)) closePicker(which)
  }
})

document.addEventListener('keydown', (e) => {
  const which = e.target.closest?.('.se-picker')?.dataset.picker
  if (!which || !pickers[which].open) return
  const p = pickers[which]
  const options = pickerOptions(which)
  if (e.key === 'ArrowDown') p.highlight = Math.min(options.length - 1, p.highlight + 1)
  else if (e.key === 'ArrowUp') p.highlight = Math.max(0, p.highlight - 1)
  else if (e.key === 'Enter') { if (options[p.highlight]) pick(which, options[p.highlight].id) }
  else if (e.key === 'Escape') closePicker(which)
  else return
  e.preventDefault()
  if (pickers[which].open) renderPicker(which)
})

document.addEventListener('input', (e) => {
  const t = e.target
  const which = t.closest?.('.se-picker')?.dataset.picker
  if (which && t.classList.contains('se-picker-input')) {
    pickers[which] = { open: true, query: t.value, highlight: 0 }
    renderPicker(which)
    return
  }
  if (t.dataset.sensor) {
    const key = t.dataset.sensor
    const n = num(t.value)
    updateOverrides((o) => {
      const next = { ...o }
      if (n === null) delete next[key]
      else next[key] = n
      return next
    })
  } else if (t.dataset.key) {
    state = { ...state, [t.dataset.key]: t.value }
    if (t.dataset.key === 'focalRatio' && state.cameraId) {
      state.focalRatioByCamera = { ...state.focalRatioByCamera, [state.cameraId]: t.value }
    }
  } else {
    return
  }
  render()
})

document.addEventListener('change', (e) => {
  const t = e.target
  if (t.id === 'se-mode') {
    state = { ...state, modeId: t.value }
    seedSensorFields()
  } else if (t.id === 'se-bortle') {
    state = { ...state, bortle: Number(t.value) }
  } else if (t.id === 'se-filter') {
    state = { ...state, filterId: t.value }
  } else if (t.dataset.compareMode !== undefined) {
    const i = Number(t.dataset.compareMode)
    state = { ...state, compare: state.compare.map((c, j) => (j === i ? { ...c, modeId: t.value } : c)) }
  } else {
    return
  }
  render()
})

document.addEventListener('click', (e) => {
  const el = e.target.closest('button, a')
  if (!el) return
  const d = el.dataset
  if (d.pick) { pick(d.picker, d.pick); return }
  if (d.mono) updateOverrides((o) => ({ ...o, mono: d.mono === '1' }))
  else if (d.sky) state = { ...state, skyMode: d.sky }
  else if (d.noise) state = { ...state, extraNoise: Number(d.noise) }
  else if (d.ratio) {
    state = { ...state, focalRatio: d.ratio }
    if (state.cameraId) state.focalRatioByCamera = { ...state.focalRatioByCamera, [state.cameraId]: d.ratio }
  } else if (d.compareRemove !== undefined) {
    const i = Number(d.compareRemove)
    state = { ...state, compare: state.compare.filter((_, j) => j !== i) }
  } else if (el.id === 'se-edit-toggle') editingSensor = !editingSensor
  else if (el.id === 'se-reset') {
    if (state.cameraId) {
      const rest = { ...state.overridesByCamera }
      delete rest[state.cameraId]
      state = { ...state, overridesByCamera: rest }
    }
    seedSensorFields()
  } else if (el.id === 'se-compare-add') {
    showComparePicker = !showComparePicker
    if (showComparePicker) {
      render()
      $('se-picker-compare').focus()
      return
    }
  } else return
  syncControls()
  render()
})

// ─── Start ──────────────────────────────────────────────────────────────────

async function start() {
  try {
    const res = await fetch('cameras.json')
    catalog = parseCatalog(await res.json())
  } catch {
    catalog = [] // the page still works with a custom camera
  }
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') } catch { /* corrupt or blocked */ }
  state = restoreState(saved, catalog)
  if (state.cameraId === null) {
    state.focalRatio = state.focalRatio || START_FOCAL_RATIO
    selectCamera(catalog.some((c) => c.id === START_CAMERA) ? START_CAMERA : 'custom')
  } else {
    seedSensorFields()
  }
  syncControls()
  render()
}

start()
