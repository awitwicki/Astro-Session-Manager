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
  const setFwhmBatch = useAppStore((s) => s.setFwhmBatch)
  const setThumbnailPathBatch = useAppStore((s) => s.setThumbnailPathBatch)

  const saveCache = useCallback(async () => {
    const state = useAppStore.getState()
    const currentRootFolder = state.rootFolder
    if (!currentRootFolder) return
    try {
      await invoke('save_cache', {
        rootFolder: currentRootFolder,
        data: {
          fwhmData: state.fwhmData,
          thumbnailPaths: state.thumbnailPaths
        }
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
        const state = useAppStore.getState()
        await invoke('save_cache', {
          rootFolder: currentRootFolder,
          data: {
            scanResult,
            mastersLibrary,
            fwhmData: state.fwhmData,
            thumbnailPaths: state.thumbnailPaths
          }
        })
      } catch {
        // Cache save is best-effort
      }
    } catch (err) {
      setScanError(String(err))
    } finally {
      setScanning(false)
    }
  }, [setScanResult, setScanning, setScanError, setMastersLibrary, saveCache])

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
        setScanError(String(err))
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

    const saved = await invoke<unknown>('get_setting', { key: 'rootFolder' })
    if (typeof saved === 'string' && saved) {
      setRootFolder(saved)

      // Load cache for instant display
      try {
        const cached = await invoke<Record<string, unknown> | null>('load_cache', { rootFolder: saved })
        if (cached) {
          if (cached.scanResult) {
            setScanResult(cached.scanResult as Parameters<typeof setScanResult>[0])
          }
          if (cached.mastersLibrary) {
            setMastersLibrary(cached.mastersLibrary as Parameters<typeof setMastersLibrary>[0])
          }
          if (cached.fwhmData) {
            setFwhmBatch(cached.fwhmData as Record<string, number>)
          }
          if (cached.thumbnailPaths) {
            setThumbnailPathBatch(cached.thumbnailPaths as Record<string, string>)
          }
        }
      } catch {
        // Cache load failed
      }

      // Auto-scan if setting is enabled
      const autoScan = await invoke<unknown>('get_setting', { key: 'autoScanOnStartup' })
      if (autoScan !== false) {
        await scan()
      }
    }
  }, [setRootFolder, setScanResult, setMastersLibrary, setFwhmBatch, setThumbnailPathBatch, scan])

  return {
    projects,
    isScanning,
    scanError,
    rootFolder,
    scan,
    selectFolder,
    init,
    saveCache
  }
}
