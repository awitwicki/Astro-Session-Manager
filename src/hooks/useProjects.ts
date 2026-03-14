import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useAppStore } from '../store/appStore'

export function useProjects() {
  const projects = useAppStore((s) => s.projects)
  const isScanning = useAppStore((s) => s.isScanning)
  const scanError = useAppStore((s) => s.scanError)
  const rootFolder = useAppStore((s) => s.rootFolder)
  const setRootFolder = useAppStore((s) => s.setRootFolder)
  const setScanResult = useAppStore((s) => s.setScanResult)
  const setScanning = useAppStore((s) => s.setScanning)
  const setScanError = useAppStore((s) => s.setScanError)
  const setMastersLibrary = useAppStore((s) => s.setMastersLibrary)
  const mergeProjectScan = useAppStore((s) => s.mergeProjectScan)

  const saveCache = useCallback(async () => {
    const state = useAppStore.getState()
    const currentRootFolder = state.rootFolder
    if (!currentRootFolder) return
    try {
      await invoke('save_cache', {
        rootFolder: currentRootFolder,
        data: {}
      })
    } catch {
      // Cache save is best-effort
    }
  }, [])

  const scan = useCallback(async () => {
    const currentRootFolder = useAppStore.getState().rootFolder
    if (!currentRootFolder) return

    setScanning(true)
    setScanError(null)
    try {
      const result = await invoke('scan_root', { rootFolder: currentRootFolder })
      const scanResult = result as Parameters<typeof setScanResult>[0]
      setScanResult(scanResult)

      // Scan masters (calibration matching happens automatically in store)
      let mastersLibrary: unknown = null
      try {
        const masters = await invoke('scan_masters', { rootFolder: currentRootFolder })
        setMastersLibrary(masters as Parameters<typeof setMastersLibrary>[0])
        mastersLibrary = masters
      } catch {
        // Masters might not exist
      }

      // Save everything to cache
      try {
        await invoke('save_cache', {
          rootFolder: currentRootFolder,
          data: {
            scanResult,
            mastersLibrary
          }
        })
      } catch {
        // Cache save is best-effort
      }
    } catch (err) {
      if (!String(err).includes('cancelled')) {
        setScanError(String(err))
      }
    } finally {
      setScanning(false)
    }
  }, [setScanResult, setScanning, setScanError, setMastersLibrary, saveCache])

  const scanProject = useCallback(async (projectPath: string) => {
    setScanning(true)
    try {
      const result = await invoke('scan_single_project', { projectPath })
      const scanResult = result as { rootPath: string; projects: unknown[]; projectHeaders: Record<string, unknown>; scanDurationMs: number }
      mergeProjectScan(result as Parameters<typeof mergeProjectScan>[0])

      // Persist to cache: merge the single-project result into existing cached scanResult
      const currentRootFolder = useAppStore.getState().rootFolder
      if (currentRootFolder) {
        try {
          const cached = await invoke<Record<string, unknown> | null>('load_cache', { rootFolder: currentRootFolder })
          const existingScan = (cached?.scanResult ?? { rootPath: currentRootFolder, projects: [], projectHeaders: {}, scanDurationMs: 0 }) as {
            rootPath: string; projects: Array<{ path: string }>; projectHeaders: Record<string, unknown>; scanDurationMs: number
          }

          // Replace or add the project in the cached projects array
          const newProject = scanResult.projects[0] as { path: string } | undefined
          if (newProject) {
            const idx = existingScan.projects.findIndex((p) => p.path === newProject.path)
            if (idx >= 0) {
              existingScan.projects[idx] = newProject
            } else {
              existingScan.projects.push(newProject)
            }
          }

          // Merge project headers
          const mergedHeaders = { ...existingScan.projectHeaders, ...scanResult.projectHeaders }

          await invoke('save_cache', {
            rootFolder: currentRootFolder,
            data: {
              scanResult: {
                ...existingScan,
                projectHeaders: mergedHeaders
              }
            }
          })
        } catch {
          // Cache save is best-effort
        }
      }
    } catch {
      // Fall back to full scan on error
      await scan()
    } finally {
      setScanning(false)
    }
  }, [mergeProjectScan, scan, setScanning])

  const selectFolder = useCallback(async () => {
    const folder = await open({ directory: true, title: 'Select Root Folder' })
    if (folder) {
      setRootFolder(folder as string)
      await invoke('set_setting', { key: 'rootFolder', value: folder })
      setScanning(true)
      setScanError(null)
      try {
        const result = await invoke('scan_root', { rootFolder: folder })
        const scanResult = result as Parameters<typeof setScanResult>[0]
        setScanResult(scanResult)

        let mastersLibrary: unknown = null
        try {
          const masters = await invoke('scan_masters', { rootFolder: folder })
          setMastersLibrary(masters as Parameters<typeof setMastersLibrary>[0])
          mastersLibrary = masters
        } catch {
          // OK
        }

        // Save to cache
        try {
          await invoke('save_cache', {
            rootFolder: folder,
            data: { scanResult, mastersLibrary }
          })
        } catch { /* best-effort */ }
      } catch (err) {
        if (!String(err).includes('cancelled')) {
          setScanError(String(err))
        }
      } finally {
        setScanning(false)
      }
    }
  }, [setRootFolder, setScanResult, setScanning, setScanError, setMastersLibrary])

  const init = useCallback(async () => {
    // Load temperature tolerance setting
    const tolerance = await invoke<unknown>('get_setting', { key: 'darkTempTolerance' })
    if (typeof tolerance === 'number') {
      useAppStore.getState().setDarkTempTolerance(tolerance)
    }

    // Load dashboard view mode
    const viewMode = await invoke<unknown>('get_setting', { key: 'dashboardViewMode' })
    if (viewMode === 'grid' || viewMode === 'table') {
      useAppStore.getState().setDashboardViewMode(viewMode)
    }

    // Load exclude patterns into store before any scan results
    const excludePatterns = await invoke<unknown>('get_setting', { key: 'excludePatterns' })
    if (typeof excludePatterns === 'string') {
      useAppStore.getState().applyExcludePatterns(excludePatterns)
    }

    const saved = await invoke<unknown>('get_setting', { key: 'rootFolder' })
    if (typeof saved === 'string' && saved) {
      setRootFolder(saved)

      // Load cache for instant display
      try {
        const cached = await invoke<Record<string, unknown> | null>('load_cache', { rootFolder: saved })
        if (cached) {
          if (cached.scanResult) {
            const scanResult = cached.scanResult as Parameters<typeof setScanResult>[0]
            setScanResult(scanResult)

            // Seed the Rust-side header cache so re-scans skip already-parsed files
            if (scanResult.projectHeaders && Object.keys(scanResult.projectHeaders).length > 0) {
              invoke('seed_header_cache', { headers: scanResult.projectHeaders }).catch(() => {})
            }
          }
          if (cached.mastersLibrary) {
            setMastersLibrary(cached.mastersLibrary as Parameters<typeof setMastersLibrary>[0])
          }
          if (cached.subAnalysis && typeof cached.subAnalysis === 'object') {
            useAppStore.getState().setSubAnalysis(cached.subAnalysis as Record<string, { medianFwhm: number; medianEccentricity: number; starsDetected: number }>)
          }
        }
      } catch {
        // Cache load failed
      }

    }
  }, [setRootFolder, setScanResult, setMastersLibrary, scan])

  return {
    projects,
    isScanning,
    scanError,
    rootFolder,
    scan,
    scanProject,
    selectFolder,
    init,
    saveCache
  }
}
