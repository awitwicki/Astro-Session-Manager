import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { ClassicSkyView } from '../components/skymap/ClassicSkyView'
import { PlannerSkyView } from '../components/skymap/PlannerSkyView'

type SkyMode = 'classic' | 'planner'

export function SkyMap() {
  const [mode, setMode] = useState<SkyMode>('classic')
  // Wait for the saved mode before mounting a view: mounting classic and
  // immediately swapping to planner would run two Celestial.display() inits.
  const [modeLoaded, setModeLoaded] = useState(false)
  const [searchParams] = useSearchParams()
  const focusTargetId = searchParams.get('target')

  useEffect(() => {
    invoke<Record<string, unknown>>('get_all_settings')
      .then((s) => {
        // A deep link always forces planner mode below — don't let the
        // saved-setting default fight (or race) that override.
        if (!focusTargetId && s.skymapMode === 'planner') setMode('planner')
      })
      .catch(() => { /* default stays classic */ })
      .finally(() => setModeLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once at mount, mirrors the query string present on first render
  }, [])

  // A deep link (`?target=`) always opens Planner mode, without persisting
  // the override to the `skymapMode` setting.
  useEffect(() => {
    if (focusTargetId) { setMode('planner'); setModeLoaded(true) }
  }, [focusTargetId])

  const pick = (m: SkyMode) => {
    setMode(m)
    invoke('set_setting', { key: 'skymapMode', value: m }).catch(() => {})
  }

  return (
    <div className="skymap-host">
      {modeLoaded && (
        mode === 'classic' ? <ClassicSkyView /> : <PlannerSkyView focusTargetId={focusTargetId} />
      )}
      <div className="skymap-mode-switch">
        <button
          className={`skymap-mode-btn${mode === 'classic' ? ' skymap-mode-btn--active' : ''}`}
          onClick={() => pick('classic')}
        >
          Sky map
        </button>
        <button
          className={`skymap-mode-btn${mode === 'planner' ? ' skymap-mode-btn--active' : ''}`}
          onClick={() => pick('planner')}
        >
          Planner
        </button>
      </div>
    </div>
  )
}
