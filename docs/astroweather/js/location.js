// Location persistence + picker UI (Leaflet map, GPS button).
// Leaflet's global `L` comes from the CDN script tag in index.html; with the
// CDN stylesheet, Leaflet resolves its default marker icons itself (no path
// fix needed, unlike the Vite build in the desktop app).

import { el } from './dom.js'

const LOCATION_KEY = 'astroweather.location'

export function loadLocation(storage = window.localStorage) {
  try {
    const raw = storage.getItem(LOCATION_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (typeof v.lat === 'number' && typeof v.lon === 'number') return { lat: v.lat, lon: v.lon }
  } catch {
    /* corrupt or inaccessible storage → treat as unset */
  }
  return null
}

export function saveLocation(loc, storage = window.localStorage) {
  try {
    storage.setItem(LOCATION_KEY, JSON.stringify(loc))
  } catch {
    /* private-mode storage may reject writes; the session still works */
  }
}

export function initLocationBar(root, initial, onChange) {
  let current = initial
  let map = null
  let marker = null

  const coordsEl = el('span', 'loc-coords')
  const msgEl = el('span', 'loc-msg')
  const gpsBtn = el('button', 'btn', 'My location')
  const mapBtn = el('button', 'btn btn-primary', 'Set on map')
  const bar = el('div', 'loc-bar')
  bar.append(coordsEl, msgEl, gpsBtn, mapBtn)

  const mapWrap = el('div', 'weather-map-container hidden')
  const mapEl = el('div', 'weather-map')
  mapWrap.append(mapEl)

  root.innerHTML = ''
  root.append(bar, mapWrap)

  function refreshLabel() {
    coordsEl.textContent = current ? `${current.lat.toFixed(4)}, ${current.lon.toFixed(4)}` : 'No location set'
  }

  function select(lat, lon) {
    current = { lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)) }
    saveLocation(current)
    refreshLabel()
    if (map) placeMarker(current.lat, current.lon)
    closeMap()
    onChange(current)
  }

  function placeMarker(lat, lon) {
    if (marker) {
      marker.setLatLng([lat, lon])
      return
    }
    marker = L.marker([lat, lon], { draggable: true }).addTo(map)
    marker.on('dragend', () => {
      const pos = marker.getLatLng()
      select(pos.lat, pos.lng)
    })
  }

  function openMap() {
    if (typeof L === 'undefined') {
      // CDN unreachable (offline at the observing site) — GPS and a saved
      // location still work, so degrade with a message instead of throwing.
      showMsg('Map failed to load — check connection')
      return
    }
    mapWrap.classList.remove('hidden')
    if (map) {
      map.invalidateSize()
      return
    }
    map = L.map(mapEl).setView([current ? current.lat : 50, current ? current.lon : 20], current ? 8 : 5)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)
    if (current) placeMarker(current.lat, current.lon)
    map.on('click', (e) => {
      placeMarker(e.latlng.lat, e.latlng.lng)
      select(e.latlng.lat, e.latlng.lng)
    })
    setTimeout(() => map.invalidateSize(), 100)
  }

  function closeMap() {
    mapWrap.classList.add('hidden')
  }

  function showMsg(text) {
    msgEl.textContent = text
    setTimeout(() => {
      msgEl.textContent = ''
    }, 5000)
  }

  gpsBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showMsg('Geolocation not supported')
      return
    }
    gpsBtn.disabled = true
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        gpsBtn.disabled = false
        select(pos.coords.latitude, pos.coords.longitude)
      },
      () => {
        gpsBtn.disabled = false
        showMsg('Location unavailable — pick on the map')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  })

  mapBtn.addEventListener('click', () => {
    if (mapWrap.classList.contains('hidden')) openMap()
    else closeMap()
  })

  refreshLabel()
  return { openMap }
}
