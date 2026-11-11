// Website version of the app's filter calculator
// (src/components/calculators/FilterCalculator.tsx). The math and the chart
// geometry are the app's own modules, generated into this folder; this file is
// only the page around them.

import { analyze, baaderCategory, lineColor, opticsFromScope } from './fbsc.js'
import { apertureView, bandChart, sweepChart } from './fbscCharts.js'

const LINES = [
  { id: 'ha', name: 'Hα', nm: 656.3 },
  { id: 'oiii', name: 'OIII', nm: 500.7 },
  { id: 'sii', name: 'SII', nm: 671.6 },
  { id: 'sii2', name: 'SII', nm: 673.1 },
  { id: 'hb', name: 'Hβ', nm: 486.1 },
  { id: 'oiii2', name: 'OIII', nm: 495.9 },
]

const FWHM_PRESETS = [3, 3.5, 4, 6.5, 7, 12]

// Aperture, focal length and obstruction diameter in mm. Obstruction shares
// are the ones Baader plots in the selection charts of the paper.
const SCOPES = [
  { id: 'rasa8', label: 'RASA 8 (f/2, 46 %)', aperture: 203, focal: 400, obstruction: 93 },
  { id: 'rasa11', label: 'RASA 11 (f/2.2, 40 %)', aperture: 279, focal: 620, obstruction: 112 },
  { id: 'newton', label: '8" f/4 Newtonian (34 %)', aperture: 200, focal: 800, obstruction: 68 },
  { id: 'refractor', label: 'Refractor f/6 (none)', aperture: 100, focal: 600, obstruction: 0 },
]

const RATIO_CHIPS = [2, 2.2, 2.8, 3.3, 4, 5.6]

const SOURCES = [
  {
    author: 'Baader Planetarium GmbH',
    title: 'Narrowband Filters on Astronomical Telescopes (3 May 2022, PDF)',
    url: 'https://www.baader-planetarium.com/media/mageworx/downloads/attachment/file/1794/EN_Baader_filter_selection_03Mai22.pdf',
    note: 'The model used here: the tilt formula, adding up rings of the aperture, the central obstruction, and the pre-shifted filter classes.',
  },
  {
    author: 'Cuiv, The Lazy Geek',
    title: 'Video on filter bandpass shift, with the spreadsheet these calculators grew from',
    url: 'https://www.youtube.com/watch?v=V4snlZYduNg',
    note: 'The flat-top Gaussian band shape and the area-weighted transmission at one emission line.',
  },
  {
    author: 'Orphi',
    title: 'Online Filter Bandpass Shift Calculator',
    url: 'https://astronomytools.orphi.eu/fbsc.html',
    note: 'The web version of that spreadsheet, and the search for the filter centre that passes the most light.',
  },
  {
    author: 'A. Tofahrn',
    title: 'Bandpass Shift Calculator',
    url: 'https://www.tofahrn-foto.de/en/tips-and-tricks/astro-photography/bandpass-shift-calculator/',
    note: "An extension of Orphi's calculator that shows transmission across the aperture radius.",
  },
]

// Every input keeps its text as typed, like the app's controlled inputs.
const state = {
  lineId: 'ha',
  target: '656.3',
  center: '656.3',
  fwhm: '6.5',
  flat: '4',
  peak: '94',
  neff: '2',
  mode: 'scope',
  scopeId: 'rasa8',
  aperture: '203',
  focal: '400',
  obstructionMm: '93',
  ratio: '2',
  obstructionPct: '46',
}

const num = (s) => {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
/** Up to `digits` decimals, trailing zeros dropped. */
const trim = (n, digits) => String(Number(n.toFixed(digits)))
const pct = (t) => `${trim(t * 100, 1)} %`
const deg = (rad) => trim((rad * 180) / Math.PI, 1)
const signed = (n, digits) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${trim(Math.abs(n), digits)}`
const $ = (id) => document.getElementById(id)

// ─── Page skeleton (built once; only values and results change later) ───────

function field(id, label, unit, control) {
  return `<div class="calc-field">
    <label class="calc-field-label" for="${id}">${label}${unit ? `<span class="fc-unit">${unit}</span>` : ''}</label>
    ${control}
  </div>`
}

const numberInput = (id, key, attrs = '') =>
  `<input id="${id}" data-key="${key}" class="calc-input" type="number" step="any" ${attrs} />`

function cone(x, fRatio, label, note) {
  // To scale: half-width at the aperture is height / (2 · focal ratio).
  const top = 26
  const focus = 150
  const half = (focus - top) / (2 * fRatio)
  const filterY = 122
  const filterHalf = ((focus - filterY) / (focus - top)) * half + 9
  return `<text x="${x}" y="14" text-anchor="middle" class="fc-cone-label">${label}</text>
    <polygon points="${x - half},${top} ${x + half},${top} ${x},${focus}" class="fc-cone" />
    <line x1="${x - half}" y1="${top}" x2="${x + half}" y2="${top}" class="fc-cone-aperture" />
    <line x1="${x - filterHalf}" y1="${filterY}" x2="${x + filterHalf}" y2="${filterY}" class="fc-cone-filter" />
    <circle cx="${x}" cy="${focus}" r="2.5" class="fc-cone-focus" />
    <text x="${x}" y="170" text-anchor="middle" class="fc-cone-note">${note}</text>`
}

$('app').innerHTML = `
  <div class="fc-head">
    <p class="calc-section-desc">
      How much of an emission line a narrowband filter still passes once it sits in your
      telescope's light cone.
    </p>
    <button class="btn" id="fc-why">Why do I need this?</button>
  </div>

  <div class="fc-inputs">
    <div class="calc-panel fc-card">
      <h2 class="fc-card-title">Filter</h2>
      <div class="fc-grid">
        ${field('fc-line', 'Emission line', '', `<select id="fc-line" class="calc-select">
          ${LINES.map((l) => `<option value="${l.id}">${l.name} ${l.nm} nm</option>`).join('')}
          <option value="custom" disabled>Custom</option>
        </select>`)}
        ${field('fc-target', 'Line wavelength', 'nm', numberInput('fc-target', 'target'))}
        ${field('fc-center', 'Filter centre', 'nm', numberInput('fc-center', 'center'))}
        ${field('fc-fwhm', 'Width (FWHM)', 'nm', `<div class="fc-combo">
          ${numberInput('fc-fwhm', 'fwhm')}
          <select id="fc-fwhm-preset" class="calc-select" aria-label="Common widths">
            <option value="" disabled>…</option>
            ${FWHM_PRESETS.map((v) => `<option value="${v}">${v} nm</option>`).join('')}
          </select>
        </div>`)}
        ${field('fc-flat', 'Flat top', 'nm', numberInput('fc-flat', 'flat', 'min="0"'))}
        ${field('fc-peak', 'Peak transmission', '%', numberInput('fc-peak', 'peak', 'min="0" max="100"'))}
        ${field('fc-neff', 'Effective index', '', `<input id="fc-neff" data-key="neff" class="calc-input" type="number" step="0.05" min="1" />`)}
        <div class="fc-field-note" id="fc-offset-note"></div>
      </div>
    </div>

    <div class="calc-panel fc-card">
      <div class="fc-card-head">
        <h2 class="fc-card-title">Telescope</h2>
        <div class="calc-seg" role="group" aria-label="How to describe the telescope">
          <button type="button" class="calc-seg-btn" data-mode="scope">Aperture + focal length</button>
          <button type="button" class="calc-seg-btn" data-mode="ratio">Focal ratio</button>
        </div>
      </div>
      <div class="fc-grid">
        <div class="fc-span">
          ${field('fc-scope', 'Start from', '', `<select id="fc-scope" class="calc-select">
            ${SCOPES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}
            <option value="" disabled>My own numbers</option>
          </select>`)}
        </div>
        <div class="fc-mode fc-grid fc-span" data-for="scope">
          ${field('fc-aperture', 'Aperture', 'mm', numberInput('fc-aperture', 'aperture', 'min="0" data-scope'))}
          ${field('fc-focal', 'Focal length', 'mm', numberInput('fc-focal', 'focal', 'min="0" data-scope'))}
          ${field('fc-obstruction', 'Obstruction', 'mm', numberInput('fc-obstruction', 'obstructionMm', 'min="0" data-scope'))}
        </div>
        <div class="fc-mode fc-grid fc-span" data-for="ratio">
          ${field('fc-ratio', 'Focal ratio', 'f/', `<input id="fc-ratio" data-key="ratio" data-scope class="calc-input" type="number" step="0.1" min="0" />`)}
          ${field('fc-obstruction-pct', 'Obstruction', '% of diameter', numberInput('fc-obstruction-pct', 'obstructionPct', 'min="0" max="99" data-scope'))}
          <div class="fc-span fc-chips" role="group" aria-label="Common focal ratios">
            ${RATIO_CHIPS.map((v) => `<button type="button" class="fc-chip" data-ratio="${v}">f/${v}</button>`).join('')}
          </div>
        </div>
        <div class="fc-field-note fc-span" id="fc-optics-note"></div>
      </div>
    </div>
  </div>

  <div id="fc-output"></div>

  <div class="calc-panel fc-card fc-sources">
    <h2 class="fc-card-title">Method and sources</h2>
    <p class="fc-caption">
      A ray tilted by θ sees the band at λ·√(1 − (sin θ / n)²). The aperture is cut into 120 rings
      between the obstruction and the edge, each with its own tilt (tan θ = radius / focal
      length), and their bands are added weighted by ring area. The band shape is a flat top
      with Gaussian edges. With an effective index of 2.0 the result lands within a few points
      of the losses Baader reports for their 3.5 nm filters at f/2.3; real filters differ, so
      treat the numbers as a good estimate, not a measurement. Temperature drift is not modelled.
    </p>
    <ul class="fc-source-list">
      ${SOURCES.map((s) => `<li><b>${s.author}</b>
        <a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>
        <span>${s.note}</span></li>`).join('')}
    </ul>
  </div>

  <div class="modal-overlay" id="fc-explainer" hidden>
    <div class="modal fc-explainer" role="dialog" aria-modal="true" aria-label="Why this calculator exists">
      <div class="fc-explainer-head">
        <h3 class="modal-title">Why do I need this?</h3>
        <button class="btn btn-sm" id="fc-explainer-close" title="Close" aria-label="Close">✕</button>
      </div>
      <p>
        A narrowband filter is a very picky gate. It lets through one exact colour of light, for
        example the red glow of hydrogen in a nebula, and blocks almost everything else,
        including street lights and moonlight.
      </p>
      <p>
        The gate only sits in the right place for light that hits the filter <b>straight on</b>.
        Light that arrives at an angle finds the gate moved a little towards blue.
      </p>
      <svg viewBox="0 0 420 178" class="fc-explainer-art" role="img"
        aria-label="A slow telescope has a narrow light cone, a fast telescope a wide one">
        ${cone(105, 7, 'Slow telescope, f/7', 'light arrives almost straight')}
        ${cone(315, 2, 'Fast telescope, f/2', 'light arrives at steep angles')}
      </svg>
      <p>
        A fast telescope (a small f-number, like f/2) squeezes light into a wide, steep cone. Much
        of that light crosses the filter at an angle, the gate slides off the nebula's colour, and
        part of the signal you spent the night collecting is thrown away. The narrower the filter,
        the sooner this hurts. A mirror telescope with a secondary mirror in the middle loses the
        straight-on light first, which makes it worse.
      </p>
      <h4>What the calculator tells you</h4>
      <ul>
        <li>How much of the nebula's light really gets through with <b>your</b> telescope and filter.</li>
        <li>Whether a filter you want to buy fits your telescope before you pay for it.</li>
        <li>Whether you need a "high-speed" filter, one made with its gate moved towards red on
          purpose so a fast telescope moves it back to the right place, and by how much.</li>
      </ul>
      <p class="fc-explainer-rule">
        Rule of thumb: slower than f/4, nearly any filter works. At f/3.4 and faster, check first.
      </p>
    </div>
  </div>`

// ─── Charts ─────────────────────────────────────────────────────────────────

function axes(box, xTicks, yTicks) {
  return `<g class="fc-axes">
    ${yTicks.map((t) => `<line x1="${box.left}" y1="${t.pos}" x2="${box.right}" y2="${t.pos}" class="fc-gridline" />
      <text x="${box.left - 8}" y="${t.pos + 3.5}" text-anchor="end">${t.label}</text>`).join('')}
    ${xTicks.map((t) => `<line x1="${t.pos}" y1="${box.bottom}" x2="${t.pos}" y2="${box.bottom + 4}" class="fc-tick" />
      <text x="${t.pos}" y="${box.bottom + 17}" text-anchor="middle">${t.label}</text>`).join('')}
    <line x1="${box.left}" y1="${box.bottom}" x2="${box.right}" y2="${box.bottom}" class="fc-axis" />
  </g>`
}

function axisTitles(box, xTitle, yTitle) {
  const midY = (box.top + box.bottom) / 2
  return `<text x="${(box.left + box.right) / 2}" y="${box.h - 4}" text-anchor="middle" class="fc-axis-title">${xTitle}</text>
    <text x="12" y="${midY}" text-anchor="middle" class="fc-axis-title" transform="rotate(-90 12 ${midY})">${yTitle}</text>`
}

function bandChartSvg(chart, lineLabel, color) {
  const { box } = chart
  const labelRight = chart.targetX < (box.left + box.right) / 2
  return `<figure class="fc-figure">
    <svg viewBox="0 0 ${box.w} ${box.h}" class="fc-svg" role="img"
      aria-label="Filter transmission against wavelength, in a parallel beam and through the telescope">
      ${axes(box, chart.xTicks, chart.yTicks)}
      ${axisTitles(box, 'Wavelength, nm', 'Transmission, %')}
      ${chart.contributions.map((d, i) =>
        `<path d="${d}" class="fc-contribution" opacity="${0.25 + (0.6 * i) / (chart.contributions.length - 1)}" />`).join('')}
      <path d="${chart.effectiveArea}" class="fc-effective-area" />
      <path d="${chart.parallel}" class="fc-parallel" />
      <path d="${chart.effective}" class="fc-effective" />
      <line x1="${chart.targetX}" y1="${box.top}" x2="${chart.targetX}" y2="${box.bottom}" stroke="${color}" stroke-width="2" />
      <text x="${chart.targetX + (labelRight ? -4 : 4)}" y="${box.top - 8}" text-anchor="${labelRight ? 'start' : 'end'}"
        style="fill: ${color}" class="fc-line-label">${lineLabel}</text>
    </svg>
    <figcaption class="fc-legend">
      <span><i class="fc-swatch fc-swatch-parallel"></i> Filter as sold (straight light)</span>
      <span><i class="fc-swatch fc-swatch-effective"></i> Filter on this telescope</span>
      <span><i class="fc-swatch fc-swatch-contribution"></i> Built up from the centre of the aperture outwards</span>
      <span><i class="fc-swatch" style="border-top-color: ${color}"></i> Emission line</span>
    </figcaption>
  </figure>`
}

function apertureSvg(view, centerDeg, edgeDeg) {
  const c = view.center
  return `<figure class="fc-figure fc-figure-aperture">
    <svg viewBox="0 0 ${view.size} ${view.size}" class="fc-svg fc-svg-aperture" role="img"
      aria-label="Front view of the aperture: zones coloured by how much of the line they pass">
      ${view.rings.map((ring) =>
        `<circle cx="${c}" cy="${c}" r="${ring.r}" fill="none" stroke="${ring.color}" stroke-width="${ring.width}" />`).join('')}
      ${view.obstructionR > 0 ? `<circle cx="${c}" cy="${c}" r="${view.obstructionR}" class="fc-obstruction" />` : ''}
      <circle cx="${c}" cy="${c}" r="${view.outerR}" class="fc-aperture-rim" />
    </svg>
    <figcaption>
      <div class="fc-scale"><span>blocked</span><i class="fc-scale-bar"></i><span>passes</span></div>
      <div class="fc-note">Rays hit the filter at ${centerDeg}° (inner) to ${edgeDeg}° (edge)</div>
    </figcaption>
  </figure>`
}

function sweepSvg(chart, markerColor) {
  const { box } = chart
  return `<figure class="fc-figure">
    <svg viewBox="0 0 ${box.w} ${box.h}" class="fc-svg" role="img"
      aria-label="Transmission at the emission line against the telescope's focal ratio">
      ${axes(box, chart.xTicks, chart.yTicks)}
      ${axisTitles(box, 'Focal ratio', 'At the line, %')}
      <path d="${chart.area}" class="fc-effective-area" />
      <path d="${chart.line}" class="fc-effective" />
      <line x1="${chart.marker.x}" y1="${chart.marker.y}" x2="${chart.marker.x}" y2="${box.bottom}" class="fc-marker-drop" />
      <circle cx="${chart.marker.x}" cy="${chart.marker.y}" r="5" fill="${markerColor}" class="fc-marker" />
    </svg>
  </figure>`
}

// ─── State → page ───────────────────────────────────────────────────────────

function scopeOptics() {
  const a = num(state.aperture)
  const fl = num(state.focal)
  const o = num(state.obstructionMm)
  return a === null || fl === null || o === null ? null : opticsFromScope(a, fl, o)
}

function ratioOptics() {
  const f = num(state.ratio)
  const o = num(state.obstructionPct)
  return f === null || o === null ? null : { fRatio: f, obstruction: o / 100 }
}

/** Write state into the controls (after a preset, a mode switch, "Try it"). */
function syncControls() {
  for (const el of document.querySelectorAll('[data-key]')) {
    if (el.value !== state[el.dataset.key]) el.value = state[el.dataset.key]
  }
}

function render() {
  const target = num(state.target)
  const center = num(state.center)
  const line = LINES.find((l) => l.id === state.lineId)
  const onLine = Boolean(line) && target === line.nm

  $('fc-line').value = onLine ? state.lineId : 'custom'
  $('fc-fwhm-preset').value = FWHM_PRESETS.includes(Number(state.fwhm)) ? String(Number(state.fwhm)) : ''
  $('fc-scope').value = state.scopeId
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('active', b.dataset.mode === state.mode)
  for (const g of document.querySelectorAll('.fc-mode')) g.hidden = g.dataset.for !== state.mode
  for (const b of document.querySelectorAll('[data-ratio]')) b.classList.toggle('active', num(state.ratio) === Number(b.dataset.ratio))

  const offset = center !== null && target !== null ? center - target : null
  $('fc-offset-note').textContent = offset === null ? ''
    : Math.abs(offset) < 0.05 ? 'Centred on the line'
    : `Centre is ${signed(offset, 2)} nm from the line${offset > 0 ? ' (pre-shifted)' : ''}`

  const optics = state.mode === 'scope' ? scopeOptics() : ratioOptics()
  $('fc-optics-note').textContent = optics && optics.fRatio > 0
    ? `f/${trim(optics.fRatio, 2)} · obstruction ${trim(optics.obstruction * 100, 0)} % of the diameter`
    : ''

  const w = num(state.fwhm)
  const ft = num(state.flat)
  const p = num(state.peak)
  const n = num(state.neff)
  const filter = center === null || w === null || ft === null || p === null || n === null ? null
    : { centerNm: center, fwhmNm: w, flatTopNm: ft, peak: p / 100, nEff: n }
  const result = filter && optics && target !== null ? analyze(filter, optics, target) : null

  if (!result) {
    const problem = !filter || !optics || target === null ? 'Fill in every field.'
      : filter.flatTopNm >= filter.fwhmNm ? 'The flat top has to be narrower than the FWHM.'
      : filter.peak <= 0 || filter.peak > 1 ? 'Peak transmission is a percentage between 0 and 100.'
      : filter.nEff < 1 ? 'The effective refractive index cannot be below 1.'
      : optics.obstruction >= 1 || optics.obstruction < 0 ? 'The obstruction has to be smaller than the aperture.'
      : 'Check the numbers: one of them is zero or negative.'
    $('fc-output').innerHTML = `<div class="fc-problem">${problem}</div>`
    return
  }

  const lineName = onLine ? line.name : 'the line'
  const lineLabel = `${onLine ? `${line.name} ` : ''}${trim(target, 1)} nm`
  const color = lineColor(target)
  // How much of what the filter could pass at best actually arrives.
  const kept = result.atTarget / filter.peak
  const verdict = kept >= 0.9 ? { cls: 'good', text: 'Good match', tone: 'success' }
    : kept >= 0.7 ? { cls: 'fair', text: 'Noticeable loss', tone: 'warning' }
    : { cls: 'poor', text: 'Poor match', tone: 'error' }
  const category = baaderCategory(filter.fwhmNm, optics.fRatio)
  const cost = result.parallelAtTarget - result.atTarget
  const costText = cost > 0.0005 ? `the light cone costs ${trim(cost * 100, 1)} points`
    : cost < -0.0005 ? `the light cone gains ${trim(-cost * 100, 1)} points`
    : 'the light cone costs nothing'

  $('fc-output').innerHTML = `
    <div class="fc-results">
      <div class="fc-hero fc-${verdict.cls}">
        <div class="calc-result-label">Light of ${lineName} that gets through</div>
        <div class="fc-hero-row">
          <div class="fc-hero-value">${pct(result.atTarget)}</div>
          <div class="fc-verdict">${verdict.text}</div>
        </div>
        <div class="fc-meter" aria-hidden="true">
          <i class="fc-meter-fill" style="width: ${result.atTarget * 100}%"></i>
          <i class="fc-meter-mark" style="left: ${result.parallelAtTarget * 100}%"></i>
        </div>
        <div class="calc-result-sub">Same filter in straight light: ${pct(result.parallelAtTarget)} · ${costText}</div>
      </div>
      <div class="fc-stats">
        <div class="calc-result-card">
          <div class="calc-result-label">Band moves by</div>
          <div class="calc-result-value">−${trim(result.meanShiftNm, 2)} nm</div>
          <div class="calc-result-sub">−${trim(result.shiftMinNm, 2)} nm (inner rays) to −${trim(result.shiftMaxNm, 2)} nm (edge)</div>
        </div>
        <div class="calc-result-card">
          <div class="calc-result-label">Band at the camera</div>
          <div class="calc-result-value">${trim(result.effCenterNm, 1)} nm</div>
          <div class="calc-result-sub">${trim(result.effFwhmNm, 1)} nm wide · peak ${pct(result.peakT)}</div>
        </div>
        <div class="calc-result-card">
          <div class="calc-result-label">Best filter centre</div>
          <div class="calc-result-value">${trim(result.bestCenterNm, 1)} nm</div>
          <div class="calc-result-sub fc-sub-action">
            <span>${signed(result.bestCenterNm - target, 1)} nm from the line → ${pct(result.bestAtTarget)}</span>
            <button type="button" class="fc-link" data-try="${trim(result.bestCenterNm, 1)}">Try it</button>
          </div>
        </div>
        <div class="calc-result-card">
          <div class="calc-result-label">Baader would sell you</div>
          <div class="calc-result-value fc-value-text">${category.name}</div>
          <div class="calc-result-sub">their ${category.family} class for ${category.range}</div>
        </div>
      </div>
    </div>

    <div class="calc-panel fc-card">
      <h2 class="fc-card-title">What the filter passes</h2>
      <p class="fc-caption">
        Each zone of the aperture sees the filter moved by a different amount. Added together
        they give a band that is shifted towards blue, wider and lower than the one printed on
        the box.
      </p>
      ${bandChartSvg(bandChart(filter, result, target), lineLabel, color)}
    </div>

    <div class="fc-pair">
      <div class="calc-panel fc-card">
        <h2 class="fc-card-title">Where the light is lost</h2>
        <p class="fc-caption">The front of your telescope. Green zones deliver ${lineName}, red zones are blocked by the filter.</p>
        ${apertureSvg(apertureView(filter, result, target), deg(result.thetaMinRad), deg(result.thetaMaxRad))}
      </div>
      <div class="calc-panel fc-card">
        <h2 class="fc-card-title">This filter on other telescopes</h2>
        <p class="fc-caption">Same filter and obstruction at every focal ratio. The dot is your telescope.</p>
        ${sweepSvg(sweepChart(filter, optics, target, result.atTarget), `var(--color-${verdict.tone})`)}
      </div>
    </div>`
}

// ─── Events ─────────────────────────────────────────────────────────────────

document.addEventListener('input', (e) => {
  const key = e.target.dataset?.key
  if (!key) return
  state[key] = e.target.value
  if ('scope' in e.target.dataset) state.scopeId = ''
  render()
})

$('fc-line').addEventListener('change', (e) => {
  const line = LINES.find((l) => l.id === e.target.value)
  if (!line) return
  // Keep a pre-shift the user has dialled in.
  const target = num(state.target)
  const center = num(state.center)
  const offset = target !== null && center !== null ? center - target : 0
  state.lineId = line.id
  state.target = String(line.nm)
  state.center = trim(line.nm + offset, 2)
  syncControls()
  render()
})

$('fc-fwhm-preset').addEventListener('change', (e) => {
  state.fwhm = e.target.value
  // Typical for the measured curves in Baader's figures: 4 of 6.5 nm, 2 of 3.5 nm.
  state.flat = trim(Number(e.target.value) * 0.6, 1)
  syncControls()
  render()
})

$('fc-scope').addEventListener('change', (e) => {
  const s = SCOPES.find((x) => x.id === e.target.value)
  if (!s) return
  state.scopeId = s.id
  state.aperture = String(s.aperture)
  state.focal = String(s.focal)
  state.obstructionMm = String(s.obstruction)
  state.ratio = trim(s.focal / s.aperture, 2)
  state.obstructionPct = trim((s.obstruction / s.aperture) * 100, 0)
  syncControls()
  render()
})

document.addEventListener('click', (e) => {
  const el = e.target.closest('button')
  if (!el) return
  if (el.dataset.mode && el.dataset.mode !== state.mode) {
    // Carry the telescope over so both modes describe the same instrument.
    const from = el.dataset.mode === 'ratio' ? scopeOptics() : ratioOptics()
    if (el.dataset.mode === 'ratio' && from) {
      state.ratio = trim(from.fRatio, 2)
      state.obstructionPct = trim(from.obstruction * 100, 1)
    }
    const a = num(state.aperture)
    if (el.dataset.mode === 'scope' && from && a !== null && a > 0) {
      state.focal = trim(a * from.fRatio, 0)
      state.obstructionMm = trim(a * from.obstruction, 1)
    }
    state.mode = el.dataset.mode
  } else if (el.dataset.ratio) {
    state.ratio = el.dataset.ratio
    state.scopeId = ''
  } else if (el.dataset.try) {
    state.center = el.dataset.try
  } else {
    return
  }
  syncControls()
  render()
})

const explainer = $('fc-explainer')
$('fc-why').addEventListener('click', () => { explainer.hidden = false })
$('fc-explainer-close').addEventListener('click', () => { explainer.hidden = true })
explainer.addEventListener('click', (e) => { if (e.target === explainer) explainer.hidden = true })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') explainer.hidden = true })

syncControls()
render()
