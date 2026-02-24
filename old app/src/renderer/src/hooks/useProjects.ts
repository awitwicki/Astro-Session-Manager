import { useCallback } from 'react'
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
    try {
      await window.electronAPI.cache.save({
        fwhmData: state.fwhmData,
        thumbnailPaths: state.thumbnailPaths
      })
    } catch {
      // Cache save is best-effort
    }
  }, [])

  const scan = useCallback(async () => {
    setScanning(true)
    setScanError(null)
    try {
      const result = await window.electronAPI.scanner.scanRoot()
      const scanResult = result as Parameters<typeof setScanResult>[0]
      setScanResult(scanResult)

      // Scan masters (calibration matching happens automatically in store)
      let mastersLibrary: unknown = null
      try {
        const masters = await window.electronAPI.masters.scan()
        setMastersLibrary(masters as Parameters<typeof setMastersLibrary>[0])
        mastersLibrary = masters
      } catch {
        // Masters might not exist
      }

      // Save everything to cache
      try {
        const state = useAppStore.getState()
        await window.electronAPI.cache.save({
          scanResult,
          mastersLibrary,
          fwhmData: state.fwhmData,
          thumbnailPaths: state.thumbnailPaths
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
    const folder = await window.electronAPI.dialog.openFolder()
    if (folder) {
      setRootFolder(folder)
      setScanning(true)
      setScanError(null)
      try {
        const result = await window.electronAPI.scanner.scanRoot()
        const scanResult = result as Parameters<typeof setScanResult>[0]
        setScanResult(scanResult)

        let mastersLibrary: unknown = null
        try {
          const masters = await window.electronAPI.masters.scan()
          setMastersLibrary(masters as Parameters<typeof setMastersLibrary>[0])
          mastersLibrary = masters
        } catch {
          // OK
        }

        // Save to cache
        try {
          await window.electronAPI.cache.save({ scanResult, mastersLibrary })
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
    const tolerance = await window.electronAPI.settings.get('darkTempTolerance')
    if (typeof tolerance === 'number') {
      useAppStore.getState().setDarkTempTolerance(tolerance)
    }

    const saved = await window.electronAPI.settings.get('rootFolder')
    if (typeof saved === 'string' && saved) {
      setRootFolder(saved)

      // Load cache for instant display
      try {
        const cached = await window.electronAPI.cache.load()
        if (cached) {
          if (cached.scanResult) {
            setScanResult(cached.scanResult as Parameters<typeof setScanResult>[0])
          }
          if (cached.mastersLibrary) {
            setMastersLibrary(cached.mastersLibrary as Parameters<typeof setMastersLibrary>[0])
          }
          if (cached.fwhmData) {
            setFwhmBatch(cached.fwhmData)
          }
          if (cached.thumbnailPaths) {
            setThumbnailPathBatch(cached.thumbnailPaths)
          }
        }
      } catch {
        // Cache load failed
      }

      // Auto-scan if setting is enabled
      const autoScan = await window.electronAPI.settings.get('autoScanOnStartup')
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
