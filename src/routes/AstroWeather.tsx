import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Fix Leaflet default marker icon path broken by Vite bundling
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})

import { useAppStore } from '../store/appStore'
import { WeatherForecast } from '../components/astroweather/WeatherForecast'
import { SeasonalDaylightChart } from '../components/astroweather/SeasonalDaylightChart'
import { LightPollutionMap } from '../components/astroweather/LightPollutionMap'
import '../styles/astroweather.css'

type Tab = 'weather' | 'daylight' | 'lightpollution'

export function AstroWeather() {
  const [tab, setTab] = useState<Tab>('weather')
  // Location lives in the store so the "Set Location" button in the top bar and
  // this page's map/tabs share one source of truth.
  const lat = useAppStore((s) => s.weatherLat)
  const lon = useAppStore((s) => s.weatherLon)
  const showMap = useAppStore((s) => s.weatherShowMap)
  const setWeatherLocation = useAppStore((s) => s.setWeatherLocation)
  const setWeatherShowMap = useAppStore((s) => s.setWeatherShowMap)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const onSelectRef = useRef<(lat: number, lon: number) => void>(() => {})

  // Load saved coordinates
  useEffect(() => {
    invoke<Record<string, unknown>>('get_all_settings').then((settings) => {
      const savedLat = typeof settings.weatherLat === 'number' ? settings.weatherLat : null
      const savedLon = typeof settings.weatherLon === 'number' ? settings.weatherLon : null
      if (savedLat !== null && savedLon !== null) {
        setWeatherLocation(savedLat, savedLon)
      }
    })
  }, [setWeatherLocation])

  // Close the map picker when leaving the page so it doesn't reopen on return
  useEffect(() => {
    return () => setWeatherShowMap(false)
  }, [setWeatherShowMap])

  // Keep onSelectRef fresh so map callbacks always use the latest state
  // eslint-disable-next-line react-hooks/refs
  onSelectRef.current = (newLat: number, newLon: number) => {
    setWeatherLocation(newLat, newLon)
    invoke('set_setting', { key: 'weatherLat', value: newLat }).catch(() => {})
    invoke('set_setting', { key: 'weatherLon', value: newLon }).catch(() => {})
    setWeatherShowMap(false)
  }

  // Initialize Leaflet map
  useEffect(() => {
    if (!showMap || !mapRef.current || mapInstanceRef.current) return

    const defaultLat = lat ?? 50
    const defaultLon = lon ?? 20

    const map = L.map(mapRef.current).setView([defaultLat, defaultLon], 6)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)

    if (lat !== null && lon !== null) {
      const marker = L.marker([lat, lon], { draggable: true }).addTo(map)
      markerRef.current = marker
      marker.on('dragend', () => {
        const pos = marker.getLatLng()
        onSelectRef.current(Number(pos.lat.toFixed(4)), Number(pos.lng.toFixed(4)))
      })
    }

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (markerRef.current) {
        markerRef.current.setLatLng(e.latlng)
      } else {
        const marker = L.marker(e.latlng, { draggable: true }).addTo(map)
        markerRef.current = marker
        marker.on('dragend', () => {
          const pos = marker.getLatLng()
          onSelectRef.current(Number(pos.lat.toFixed(4)), Number(pos.lng.toFixed(4)))
        })
      }
      onSelectRef.current(Number(e.latlng.lat.toFixed(4)), Number(e.latlng.lng.toFixed(4)))
    })

    mapInstanceRef.current = map
    setTimeout(() => map.invalidateSize(), 100)

    return () => {
      map.remove()
      mapInstanceRef.current = null
      markerRef.current = null
    }
  }, [showMap])

  return (
    <div className="weather-page">
      {showMap && (
        <div className="weather-location">
          <div className="weather-map-container">
            <div ref={mapRef} className="weather-map" />
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${tab === 'weather' ? 'active' : ''}`} onClick={() => setTab('weather')}>
          Weather
        </button>
        <button className={`tab ${tab === 'daylight' ? 'active' : ''}`} onClick={() => setTab('daylight')}>
          Day/Night duration
        </button>
        <button className={`tab ${tab === 'lightpollution' ? 'active' : ''}`} onClick={() => setTab('lightpollution')}>
          Light Pollution Map
        </button>
      </div>

      {tab === 'weather' && <WeatherForecast lat={lat} lon={lon} />}
      {tab === 'daylight' && <SeasonalDaylightChart lat={lat} lon={lon} />}
      {tab === 'lightpollution' && <LightPollutionMap lat={lat} lon={lon} />}
    </div>
  )
}
