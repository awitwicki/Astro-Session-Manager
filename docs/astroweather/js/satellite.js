// Satellite check card: EUMETSAT Meteosat IR map + current-hour cloud values
// from the blend models, so the user can see which model matches the real sky.
// Leaflet is the global `L` from index.html; every browser call stays inside
// functions so Node can import this module.

import { el } from './dom.js'
import { getCloudColor, currentHourClouds } from './weather.js'

const WMS_URL = 'https://view.eumetsat.int/geoserver/wms'
const COLLAPSE_KEY = 'astroweather.satellite.collapsed'
const WMS_BUCKET_MS = 15 * 60 * 1000 // matches the layer's own PT15M update cadence

// The EUMETSAT layer updates every 15 min and declares a `time` dimension for
// selecting a specific scan. Omitting `time` (asking for "whatever's current")
// turned out to be unreliable: reproduced repeatedly with curl and confirmed
// via Playwright network capture — the no-time GetMap response can get stuck
// mid-mosaic-update (one half of the frame newer than the other, a hard seam
// down the middle) and then gets served identically, byte-for-byte, for
// multiple requests in a row (same `Last-Modified`), presumably cached
// server-side for the full `Cache-Control: max-age=604800` (7 days) the
// response carries — vs an EXPLICIT `time=` request, which was clean in every
// trial (6/6), including the current 15-minute window requested minutes after
// it opened. Passing the current 15-minute floor as an explicit `time` value
// both avoids that broken default-resolution path and — as a side benefit —
// changes the tile URL every 15 minutes, which also keeps the browser's own
// HTTP cache from mixing tiles from different real-world capture moments
// across zoom levels or revisits. The layer's `nearestValue="1"` dimension
// setting (see GetCapabilities) covers the edge case of asking for a instant
// right at a window boundary before that scan has fully published.
export function getWmsTimeBucket(now = new Date()) {
  return new Date(Math.floor(now.getTime() / WMS_BUCKET_MS) * WMS_BUCKET_MS).toISOString()
}

let map = null
let marker = null
let wmsLayer = null
let errorNote = null
let placeholderNote = null
let els = null       // { body, mapEl, side, toggle }
let lastView = null
let centeredLat = null  // lat/lon the map view is currently centered on
let centeredLon = null
let lastBucket = null   // last 15-min cache-bust window applied to the WMS layer

const isCollapsed = () => localStorage.getItem(COLLAPSE_KEY) === '1'

export function renderSatellite(root, view) {
  lastView = view
  if (!els) buildCard(root)
  if (view.lat === null || view.lon === null) {
    // No observing location yet: don't build the live map or fetch any
    // tiles for a meaningless fallback region — show a placeholder instead.
    showPlaceholder()
  } else {
    hidePlaceholder()
    if (!isCollapsed()) initMap()
  }
  updateCard(view)
}

function buildCard(root) {
  const card = el('div', 'sat-card')
  const header = el('div', 'sat-header')
  const toggle = el('button', 'sat-toggle', isCollapsed() ? '▸' : '▾')
  // The forecast-wide "Refresh" control lives here (in the header row)
  // rather than as its own bar above the card, so it lines up with the
  // card's own header instead of floating as a taller, misaligned row on
  // top of it. Reads `lastView` (always current) rather than a snapshot,
  // since this button is built once and reused across renders.
  const refreshBtn = el('button', 'btn btn-primary btn-sm', 'Refresh')
  refreshBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (lastView) lastView.onRefresh()
  })
  header.append(
    toggle,
    el('span', 'sat-title', 'Satellite check'),
    el('span', 'sat-caption', 'EUMETSAT Meteosat IR 10.8 µm — latest frame'),
    refreshBtn,
  )
  const body = el('div', `sat-body${isCollapsed() ? ' hidden' : ''}`)
  const mapEl = el('div', 'sat-map')
  const side = el('div', 'sat-now')
  body.append(mapEl, side)
  card.append(header, body)
  root.append(card)
  els = { body, mapEl, side, toggle, refreshBtn }

  header.addEventListener('click', () => {
    const nowCollapsed = body.classList.toggle('hidden')
    toggle.textContent = nowCollapsed ? '▸' : '▾'
    localStorage.setItem(COLLAPSE_KEY, nowCollapsed ? '1' : '0')
    if (!nowCollapsed) initMap()
  })
}

function initMap() {
  // No observing location yet: nothing to center the map on, so don't
  // build it or fetch tiles (see renderSatellite's placeholder gate).
  if (!lastView || lastView.lat === null || lastView.lon === null) return
  if (map) {
    // The container may have been display:none while collapsed — Leaflet
    // caches pixel size at creation time and needs an explicit nudge to
    // redraw correctly once the container is visible again (same pattern
    // as location.js's openMap()).
    map.invalidateSize()
    return
  }
  const { lat, lon } = lastView
  map = L.map(els.mapEl).setView([lat, lon], 7)
  centeredLat = lat
  centeredLon = lon
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
  }).addTo(map)
  wmsLayer = L.tileLayer.wms(WMS_URL, {
    layers: 'msg_fes:ir108',
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    opacity: 0.75,
    attribution: 'Satellite: &copy; EUMETSAT',
    time: getWmsTimeBucket(),
  }).addTo(map)
  wmsLayer.on('tileerror', showTileError)
  lastBucket = getWmsTimeBucket()
  setTimeout(() => map.invalidateSize(), 100)
}

function showPlaceholder() {
  if (placeholderNote || !els) return
  placeholderNote = el('div', 'sat-placeholder', 'Pick your coordinates on the map above')
  els.mapEl.append(placeholderNote)
}

function hidePlaceholder() {
  if (placeholderNote) { placeholderNote.remove(); placeholderNote = null }
}

function showTileError() {
  if (errorNote || !els) return
  errorNote = el('div', 'sat-error', 'Satellite unavailable')
  els.mapEl.append(errorNote)
}

function hideTileError() {
  if (errorNote) { errorNote.remove(); errorNote = null }
}

function nowRow(label, value, weightText, extraClass) {
  const row = el('div', `sat-now-row${extraClass ? ` ${extraClass}` : ''}`)
  const chip = el('span', 'sat-chip', value === null ? '—' : `${Math.round(value)}%`)
  if (value !== null) chip.style.backgroundColor = getCloudColor(value)
  row.append(el('span', 'sat-now-label', label), chip, el('span', 'sat-weight', weightText))
  return row
}

function updateCard(view) {
  els.refreshBtn.disabled = !!view.loading
  els.refreshBtn.textContent = view.loading ? 'Loading…' : 'Refresh'
  if (wmsLayer) {
    // Re-applying the same value would still trigger Leaflet to redraw
    // every visible tile, so only call setParams when it's actually a new
    // window — keeps this a no-op on the common case (re-render between two
    // forecast refreshes inside the same 15 minutes).
    const bucket = getWmsTimeBucket()
    if (bucket !== lastBucket) {
      lastBucket = bucket
      wmsLayer.setParams({ time: bucket })
    }
  }
  if (map && view.lat !== null && view.lon !== null) {
    // Re-center whenever the observing location actually changed — not on
    // every render (e.g. a forecast refresh), which would otherwise stomp
    // on the user's own pan/zoom for no reason.
    if (centeredLat !== view.lat || centeredLon !== view.lon) {
      map.setView([view.lat, view.lon], map.getZoom())
      centeredLat = view.lat
      centeredLon = view.lon
    }
    if (marker) marker.setLatLng([view.lat, view.lon])
    else marker = L.circleMarker([view.lat, view.lon], {
      radius: 6, color: '#ffffff', weight: 2, fillColor: '#f44336', fillOpacity: 1,
    }).addTo(map)
  }

  const { side } = els
  side.innerHTML = ''
  const now = currentHourClouds(view.forecast)
  side.append(el('div', 'sat-now-title', now ? `NOW ${String(now.hour).padStart(2, '0')}:00` : 'NOW'))
  if (now) {
    for (const m of now.models) side.append(nowRow(m.label, m.total, `×${m.weight.toFixed(2)}`))
    side.append(nowRow('Blend', now.blend, '', 'blend'))
  } else {
    side.append(el('div', 'sat-now-empty', 'No forecast for the current hour'))
  }
  const refreshBtn = el('button', 'btn btn-primary sat-refresh', 'Refresh image')
  refreshBtn.addEventListener('click', () => {
    if (!wmsLayer) return
    hideTileError()
    wmsLayer.setParams({ ts: Date.now() }) // cache-bust → re-request latest frame
  })
  side.append(refreshBtn)
}
