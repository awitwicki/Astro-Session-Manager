import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../store/appStore'
import { isPlannerTargetArray, type PlannerTarget } from '../types/planner'
import { zoneFromCoords } from '../lib/timezone'

// Same fallback the Astro Weather map centers on when no location is set
export const FALLBACK_LAT = 50
export const FALLBACK_LON = 20

export function persistPlannerTargets(targets: PlannerTarget[]): void {
  invoke('set_setting', { key: 'plannerTargets', value: targets }).catch(() => {})
}

/** Hydrates saved planner targets and the observing location once per app run,
 *  and returns them with non-null fallbacks for rendering. */
export function usePlannerData() {
  const targets = useAppStore((s) => s.plannerTargets)
  const hydrated = useAppStore((s) => s.plannerHydrated)
  const lat = useAppStore((s) => s.weatherLat)
  const lon = useAppStore((s) => s.weatherLon)

  useEffect(() => {
    if (useAppStore.getState().plannerHydrated) return
    invoke<Record<string, unknown>>('get_all_settings').then((settings) => {
      const state = useAppStore.getState()
      if (!state.plannerHydrated) {
        state.setPlannerTargets(
          isPlannerTargetArray(settings.plannerTargets) ? settings.plannerTargets : [])
      }
      // Mirror the Astro Weather hydration for when Planner is opened first
      if (state.weatherLat === null
        && typeof settings.weatherLat === 'number' && typeof settings.weatherLon === 'number') {
        state.setWeatherLocation(settings.weatherLat, settings.weatherLon)
      }
    }).catch(() => {
      useAppStore.getState().setPlannerTargets([])
    })
  }, [])

  const locationSet = lat !== null && lon !== null
  const effLat = lat ?? FALLBACK_LAT
  const effLon = lon ?? FALLBACK_LON
  return {
    targets,
    hydrated,
    locationSet,
    lat: effLat,
    lon: effLon,
    timeZone: zoneFromCoords(effLat, effLon) ?? 'UTC',
  }
}
