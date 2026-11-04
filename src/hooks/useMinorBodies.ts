import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../store/appStore'
import {
  COMETS_URL, asteroidsUrl, parseAsteroidLines, parseCometLines, type MinorBody,
} from '../lib/mpc'
import { refreshMinorTargets } from '../lib/plannerTargets'
import { persistPlannerTargets } from './usePlanner'

type Kind = 'comets' | 'asteroids'

interface StoredFile { text: string; modifiedMs: number }
interface StoredFiles { comets: StoredFile | null; asteroids: StoredFile | null }

const FETCH_TIMEOUT_MS = 30_000

const parsers: Record<Kind, (text: string) => MinorBody[]> = {
  comets: parseCometLines,
  asteroids: parseAsteroidLines,
}

// Module-level so StrictMode / several hook users hydrate only once per run
let hydrating = false

async function fetchText(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

async function downloadText(kind: Kind): Promise<string> {
  if (kind === 'comets') {
    const res = await fetchText(COMETS_URL)
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    return res.text()
  }
  const year = new Date().getFullYear()
  let res = await fetchText(asteroidsUrl(year))
  if (!res.ok) res = await fetchText(asteroidsUrl(year - 1))
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  return res.text()
}

/** Comet / asteroid orbit lists from the MPC: loads the saved files once per
 *  app run and downloads fresh ones on demand. */
export function useMinorBodies() {
  const minorBodies = useAppStore((s) => s.minorBodies)
  const [downloading, setDownloading] = useState<Record<Kind, boolean>>({ comets: false, asteroids: false })
  const [error, setError] = useState<Record<Kind, string | null>>({ comets: null, asteroids: null })

  useEffect(() => {
    if (useAppStore.getState().minorBodies.hydrated || hydrating) return
    hydrating = true
    invoke<StoredFiles>('load_minor_bodies').then((files) => {
      const state = useAppStore.getState()
      for (const kind of ['comets', 'asteroids'] as const) {
        const file = files[kind]
        state.setMinorBodies(kind, file ? parsers[kind](file.text) : [], file ? file.modifiedMs : null)
      }
    }).catch(() => {
      useAppStore.getState().setMinorBodies('comets', [], null)
    }).finally(() => { hydrating = false })
  }, [])

  const download = useCallback(async (kind: Kind) => {
    setDownloading((d) => ({ ...d, [kind]: true }))
    setError((e) => ({ ...e, [kind]: null }))
    try {
      const text = await downloadText(kind)
      const bodies = parsers[kind](text)
      if (bodies.length === 0) throw new Error('No orbits found in the downloaded file')
      await invoke('save_minor_bodies', { kind, text })
      const state = useAppStore.getState()
      state.setMinorBodies(kind, bodies, Date.now())
      const refreshed = refreshMinorTargets(state.plannerTargets, bodies)
      if (refreshed !== state.plannerTargets) {
        state.setPlannerTargets(refreshed)
        persistPlannerTargets(refreshed)
      }
    } catch (e) {
      setError((prev) => ({ ...prev, [kind]: e instanceof Error ? e.message : String(e) }))
    } finally {
      setDownloading((d) => ({ ...d, [kind]: false }))
    }
  }, [])

  return {
    comets: minorBodies.comets,
    asteroids: minorBodies.asteroids,
    updatedAt: minorBodies.updatedAt,
    hydrated: minorBodies.hydrated,
    downloading,
    error,
    download,
  }
}
