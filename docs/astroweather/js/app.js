// Entry point: state, tab switching, and wiring between the location picker
// and the two tab renderers.

import { loadLocation, initLocationBar } from './location.js'
import { fetchForecast } from './weather.js'
import { renderForecast } from './forecast.js'
import { renderDaylight } from './daylight.js'
import { renderSatellite } from './satellite.js'

const state = {
  location: loadLocation(),
  forecast: null,
  loading: false,
  error: null,
  fetchToken: 0, // drops stale responses when the location changes mid-fetch
}

const forecastRoot = document.getElementById('forecast-root')
const daylightRoot = document.getElementById('daylight-root')
const satelliteRoot = document.getElementById('satellite-root')

const lat = () => (state.location ? state.location.lat : null)
const lon = () => (state.location ? state.location.lon : null)

function renderWeatherTab() {
  renderSatellite(satelliteRoot, {
    lat: lat(),
    lon: lon(),
    forecast: state.forecast,
    loading: state.loading,
    onRefresh: refreshForecast,
  })
  renderForecast(forecastRoot, {
    forecast: state.forecast,
    lat: lat(),
    loading: state.loading,
    error: state.error,
    onRefresh: refreshForecast,
  })
}

async function refreshForecast() {
  if (!state.location) {
    state.forecast = null
    renderWeatherTab()
    return
  }
  const token = ++state.fetchToken
  state.loading = true
  state.error = null
  renderWeatherTab()
  try {
    const data = await fetchForecast(state.location.lat, state.location.lon)
    if (token !== state.fetchToken) return
    state.forecast = data
  } catch (err) {
    if (token !== state.fetchToken) return
    state.forecast = null
    state.error = err instanceof Error ? err.message : String(err)
  }
  state.loading = false
  renderWeatherTab()
}

function onLocationChange(loc) {
  state.location = loc
  refreshForecast()
  renderDaylight(daylightRoot, lat(), lon())
}

// Tabs.
for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn))
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== btn.dataset.tab))
  })
}

// Boot.
const bar = initLocationBar(document.getElementById('location-bar'), state.location, onLocationChange)
renderDaylight(daylightRoot, lat(), lon())
refreshForecast()
if (!state.location) bar.openMap()
