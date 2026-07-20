import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../store/appStore'
import { isHorizonProfile, type HorizonProfile } from '../lib/horizon'

/** Fire-and-forget, matching how every other setting in this app is written. */
export function persistHorizonProfile(profile: HorizonProfile | null): void {
  invoke('set_setting', { key: 'horizonProfile', value: profile }).catch(() => {})
}

// Module-level: hydration is per app run, not per component mount, and several
// pages read the profile.
let hydrationStarted = false

/** Returns the active horizon profile, hydrating it from settings on first use. */
export function useHorizonProfile(): HorizonProfile | null {
  const profile = useAppStore((s) => s.horizonProfile)

  useEffect(() => {
    if (hydrationStarted) return
    hydrationStarted = true
    invoke<Record<string, unknown>>('get_all_settings')
      .then((settings) => {
        if (isHorizonProfile(settings.horizonProfile)) {
          useAppStore.getState().setHorizonProfile(settings.horizonProfile)
        }
      })
      .catch(() => { hydrationStarted = false })
  }, [])

  return profile
}

/**
 * The horizon profile as Planner/SkyMap should actually render and compute
 * against: `null` (a flat 0° skyline — every existing horizon function
 * already treats `null` that way) while the flat-horizon preview is on,
 * otherwise the real saved profile. Use this everywhere the horizon is
 * *consumed* for display or visibility math; `HorizonEditor` deliberately
 * keeps using `useHorizonProfile` directly so editing always targets the
 * real saved profile regardless of the preview toggle.
 */
export function useEffectiveHorizonProfile(): HorizonProfile | null {
  const profile = useHorizonProfile()
  const flatPreview = useAppStore((s) => s.flatHorizonPreview)
  return flatPreview ? null : profile
}
