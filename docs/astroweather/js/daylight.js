// Day/Night duration tab: seasonal daylight SVG chart + timezone helpers.
// Ported from src/components/astroweather/SeasonalDaylightChart.tsx and
// src/lib/timezone.ts. The desktop resolves the zone from coordinates via
// @photostructure/tz-lookup; here "auto" means the device's own zone.

import { dayPhases, dayOfYear } from './sun.js'
import { el, svgEl, emptyState } from './dom.js'

const TZ_KEY = 'astroweather.timezone'
const AUTO_TZ = 'auto'

const FALLBACK_ZONES = [
  'UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
]

/** All IANA time zones, or a small fallback list if the runtime lacks supportedValuesOf. */
export function listTimeZones() {
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      const zones = Intl.supportedValuesOf('timeZone')
      if (Array.isArray(zones) && zones.length > 0) return zones
    } catch {
      /* fall through to the fallback list */
    }
  }
  return FALLBACK_ZONES
}

/** The runtime's detected IANA time zone (e.g. "Europe/Berlin"), or "UTC". */
export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    /* return UTC fallback */
  }
  return 'UTC'
}

/** DST-aware offset in hours (east-positive) of `timeZone` at the instant `date`. */
export function tzOffsetHours(timeZone, date) {
  let zone = timeZone
  try {
    // Throws for an unknown zone; fall back to the detected one.
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    zone = detectTimeZone()
  }
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = {}
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value
  const hour = parts.hour === '24' ? 0 : Number(parts.hour)
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second),
  )
  return (asUTC - date.getTime()) / 3_600_000
}

const W = 760
const H = 380
const PAD_L = 46
const PAD_R = 14
const PAD_T = 16
const PAD_B = 30
const DAYS = 365
const Y_MIN = 12 // clock noon (top)
const Y_MAX = 36 // clock noon next day (bottom); 24 = midnight (centre)
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B

const DAYLIGHT = '#6a93ba'
const REGIONS = [
  { color: '#3f5f80', label: 'Civil twilight' },
  { color: '#27405c', label: 'Nautical twilight' },
  { color: '#172a40', label: 'Astronomical twilight' },
  { color: '#0b0f16', label: 'Astronomical dark' },
]

const MONTHS = [
  { v: 1, l: 'Jan' }, { v: 32, l: 'Feb' }, { v: 60, l: 'Mar' }, { v: 91, l: 'Apr' },
  { v: 121, l: 'May' }, { v: 152, l: 'Jun' }, { v: 182, l: 'Jul' }, { v: 213, l: 'Aug' },
  { v: 244, l: 'Sep' }, { v: 274, l: 'Oct' }, { v: 305, l: 'Nov' }, { v: 335, l: 'Dec' },
]
const Y_TICKS = [
  { h: 12, l: '12:00' }, { h: 18, l: '18:00' }, { h: 24, l: '00:00' },
  { h: 30, l: '06:00' }, { h: 36, l: '12:00' },
]

// Clock hour [0,24) → plot Y window [12,36) (noon-top, midnight-centre).
const toWindow = (clock) => (clock < 12 ? clock + 24 : clock)
const xForIndex = (i) => PAD_L + (i / (DAYS - 1)) * PLOT_W
const xForDay = (v) => xForIndex(v - 1)
const yScale = (win) => PAD_T + ((win - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_H
// Inverse of yScale, folded back to a clock hour in [0,24).
const clockForY = (y) => {
  const win = Y_MIN + ((y - PAD_T) / PLOT_H) * (Y_MAX - Y_MIN)
  return win >= 24 ? win - 24 : win
}

// Per-threshold dusk/dawn lookups (index aligns with REGIONS and bandKinds).
const DUSK = [
  (p) => p.sunset, (p) => p.civilDusk,
  (p) => p.nauticalDusk, (p) => p.astroDusk,
]
const DAWN = [
  (p) => p.sunrise, (p) => p.civilDawn,
  (p) => p.nauticalDawn, (p) => p.astroDawn,
]

// Plot-window boundaries {up, down} of region `idx` for day `p`.
function regionBoundary(p, idx) {
  const kind = p.bandKinds[idx]
  if (kind === 'alwaysBelow') return { up: Y_MIN, down: Y_MAX } // darker than this all day → fill
  if (kind === 'alwaysAbove') { const c = toWindow(p.nightCenter); return { up: c, down: c } } // never this dark → collapse
  const dusk = DUSK[idx](p)
  const dawn = DAWN[idx](p)
  if (dusk === null || dawn === null) { const c = toWindow(p.nightCenter); return { up: c, down: c } }
  return { up: toWindow(dusk), down: toWindow(dawn) }
}

// tzdata renamed the zone; ICU keeps listing the old spelling.
const zoneLabel = (z) => (z === 'Europe/Kiev' ? 'Europe/Kyiv' : z)

const pad2 = (n) => String(n).padStart(2, '0')

function fmtClock(h) {
  if (h === null) return '—'
  let hh = Math.floor(h)
  let mm = Math.round((h - hh) * 60)
  if (mm === 60) { mm = 0; hh = (hh + 1) % 24 }
  return `${pad2(hh)}:${pad2(mm)}`
}

function fmtDur(hours) {
  const total = Math.round(hours * 60)
  return `${Math.floor(total / 60)}h ${pad2(total % 60)}m`
}

function readTz() {
  try {
    return localStorage.getItem(TZ_KEY) || AUTO_TZ
  } catch {
    return AUTO_TZ
  }
}

function saveTz(v) {
  try {
    localStorage.setItem(TZ_KEY, v)
  } catch {
    /* non-persistent session is fine */
  }
}

function svgText(x, y, content, anchor) {
  const t = svgEl('text', { x, y, 'text-anchor': anchor, 'font-size': 10, fill: 'var(--color-text-muted)' })
  t.textContent = content
  return t
}

export function renderDaylight(root, lat, lon) {
  root.innerHTML = ''
  if (lat === null || lon === null) {
    root.append(emptyState('No Location Set', 'Pick your coordinates on the map above'))
    return
  }

  const tz = readTz()
  const effectiveTz = tz === AUTO_TZ ? detectTimeZone() : tz
  const refYear = new Date().getFullYear()

  // Per-day DST-aware offset, then per-day phases (clock time).
  const cols = []
  for (let d = 1; d <= DAYS; d++) {
    const offset = tzOffsetHours(effectiveTz, new Date(Date.UTC(refYear, 0, d, 12)))
    cols.push(dayPhases(lat, lon, d, offset))
  }

  // Toolbar: timezone select.
  const toolbar = el('div', 'daylight-toolbar')
  const label = el('label', null, 'Timezone')
  label.htmlFor = 'daylight-tz'
  const select = el('select', 'daylight-tz-select')
  select.id = 'daylight-tz'
  const zones = listTimeZones()
  const autoOption = el('option', null, `Auto — ${zoneLabel(detectTimeZone())}`)
  autoOption.value = AUTO_TZ
  select.append(autoOption)
  for (const z of zones.includes(tz) || tz === AUTO_TZ ? zones : [tz, ...zones]) {
    const o = el('option', null, zoneLabel(z))
    o.value = z
    select.append(o)
  }
  select.value = tz
  select.addEventListener('change', () => {
    saveTz(select.value)
    renderDaylight(root, lat, lon)
  })
  toolbar.append(label, select)

  // Chart.
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'daylight-chart-svg', role: 'img' })
  svg.setAttribute('aria-label', 'Seasonal daylight and astronomical darkness across the year (local time)')

  svg.append(svgEl('rect', { x: PAD_L, y: PAD_T, width: PLOT_W, height: PLOT_H, fill: DAYLIGHT }))

  const regionPath = (idx) => {
    const up = cols
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForIndex(i).toFixed(1)},${yScale(regionBoundary(p, idx).up).toFixed(1)}`)
      .join(' ')
    const down = cols
      .map((p, i) => ({ i, v: regionBoundary(p, idx).down }))
      .reverse()
      .map((o) => `L${xForIndex(o.i).toFixed(1)},${yScale(o.v).toFixed(1)}`)
      .join(' ')
    return `${up} ${down} Z`
  }
  REGIONS.forEach((r, idx) => svg.append(svgEl('path', { d: regionPath(idx), fill: r.color, stroke: 'none' })))

  const today = Math.min(dayOfYear(new Date()), DAYS)
  svg.append(svgEl('line', {
    x1: xForDay(today), y1: PAD_T, x2: xForDay(today), y2: H - PAD_B,
    stroke: 'var(--color-error)', 'stroke-width': 1, 'stroke-dasharray': '3 2',
  }))

  svg.append(svgEl('line', { x1: PAD_L, y1: H - PAD_B, x2: W - PAD_R, y2: H - PAD_B, stroke: 'var(--color-border)' }))
  svg.append(svgEl('line', { x1: PAD_L, y1: PAD_T, x2: PAD_L, y2: H - PAD_B, stroke: 'var(--color-border)' }))

  for (const t of Y_TICKS) svg.append(svgText(PAD_L - 6, yScale(t.h) + 3, t.l, 'end'))
  for (const m of MONTHS) svg.append(svgText(xForDay(m.v), H - 10, m.l, 'middle'))

  // Crosshair, hidden until the first pointer interaction.
  const crossAttrs = { stroke: 'var(--color-text-primary)', 'stroke-width': 1, 'stroke-dasharray': '2 2', opacity: 0.7, visibility: 'hidden' }
  const vLine = svgEl('line', { y1: PAD_T, y2: H - PAD_B, ...crossAttrs })
  const hLine = svgEl('line', { x1: PAD_L, x2: W - PAD_R, ...crossAttrs })
  // Masks the tick label underneath so the hover time stays readable.
  const timeMask = svgEl('rect', { x: 0, width: PAD_L - 2, height: 14, fill: 'var(--color-bg-secondary)', visibility: 'hidden' })
  const timeText = svgEl('text', {
    x: PAD_L - 6, 'text-anchor': 'end', 'font-size': 10, 'font-weight': 600,
    fill: 'var(--color-text-primary)', visibility: 'hidden',
  })
  svg.append(vLine, hLine, timeMask, timeText)

  const panel = el('div', 'daylight-hover-panel', 'Tap or drag on the chart to inspect a day')

  function updateHover(e) {
    const rect = svg.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const vy = ((e.clientY - rect.top) / rect.height) * H
    const i = Math.round(((vx - PAD_L) / PLOT_W) * (DAYS - 1))
    if (i < 0 || i >= DAYS) return

    const x = xForIndex(i).toFixed(1)
    vLine.setAttribute('x1', x)
    vLine.setAttribute('x2', x)
    vLine.setAttribute('visibility', 'visible')

    if (vy >= PAD_T && vy <= H - PAD_B) {
      hLine.setAttribute('y1', vy.toFixed(1))
      hLine.setAttribute('y2', vy.toFixed(1))
      timeMask.setAttribute('y', (vy - 7).toFixed(1))
      timeText.setAttribute('y', (vy + 3).toFixed(1))
      timeText.textContent = fmtClock(clockForY(vy))
      hLine.setAttribute('visibility', 'visible')
      timeMask.setAttribute('visibility', 'visible')
      timeText.setAttribute('visibility', 'visible')
    }

    const p = cols[i]
    const dateStr = new Date(refYear, 0, i + 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const sunLine = p.sunUpAllDay
      ? 'Sun up all day'
      : p.sunDownAllDay
        ? 'Sun down all day'
        : `Sunrise ${fmtClock(p.sunrise)} · Sunset ${fmtClock(p.sunset)}`
    const darkLine = p.darkHours > 0
      ? `${fmtClock(p.astroDusk)}–${fmtClock(p.astroDawn)} (${fmtDur(p.darkHours)})`
      : 'none'

    panel.innerHTML = ''
    panel.append(
      el('div', 'daylight-hover-date', dateStr),
      el('div', null, sunLine),
      el('div', null, `Daylight: ${p.daylightHours !== null ? fmtDur(p.daylightHours) : '—'}`),
      el('div', 'daylight-hover-dark', `Astro night: ${darkLine}`),
    )
  }

  svg.addEventListener('pointerdown', updateHover)
  svg.addEventListener('pointermove', (e) => {
    // Mouse: live hover. Touch: only while a finger is down (drag to scrub).
    if (e.pointerType === 'mouse' || e.buttons > 0) updateHover(e)
  })

  const legend = el('div', 'daylight-chart-legend')
  const swatch = (color, text) => {
    const s = el('span')
    const i = el('i', 'daylight-swatch')
    i.style.background = color
    s.append(i, ` ${text}`)
    return s
  }
  legend.append(swatch(DAYLIGHT, 'Daylight'))
  for (const r of REGIONS) legend.append(swatch(r.color, r.label))

  const wrap = el('div', 'daylight-chart')
  wrap.append(toolbar, svg, panel, legend)
  root.append(wrap)
}
