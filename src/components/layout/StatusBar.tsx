import { useState, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../../store/appStore'

interface ScanProgress {
  phase: string
  current: number
  total: number
  filePath: string
}

export function StatusBar() {
  const isScanning = useAppStore((s) => s.isScanning)
  const importProgress = useAppStore((s) => s.importProgress)
  const setImportProgress = useAppStore((s) => s.setImportProgress)
  const [progress, setProgress] = useState<ScanProgress | null>(null)

  useEffect(() => {
    const unlisten = listen<ScanProgress>('scan:progress', (event) => {
      setProgress(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  // Listen for import progress events
  useEffect(() => {
    const unlistenProgress = listen<{ current: number; total: number; filename: string }>(
      'import:progress',
      (event) => {
        setImportProgress(event.payload)
      }
    )
    const unlistenDone = listen('import:done', () => {
      setImportProgress(null)
    })

    return () => {
      unlistenProgress.then((fn) => fn())
      unlistenDone.then((fn) => fn())
    }
  }, [setImportProgress])

  // Clear progress when scan finishes
  useEffect(() => {
    if (!isScanning) {
      setProgress(null)
    }
  }, [isScanning])

  const showScan = isScanning
  const showImport = importProgress != null

  if (!showScan && !showImport) return null

  const scanPct = progress ? (progress.current / progress.total) * 100 : 0
  const scanLabel =
    progress?.phase === 'scanning'
      ? `Scanning projects: ${progress.current}/${progress.total}`
      : progress?.phase === 'headers'
        ? `Reading headers: ${progress.current}/${progress.total}`
        : 'Synchronizing...'

  const importPct = importProgress ? (importProgress.current / importProgress.total) * 100 : 0

  return (
    <div className="app-statusbar">
      {showScan && (
        <>
          <div className="statusbar-left">
            <div className="spinner" style={{ width: 12, height: 12 }} />
            <span className="statusbar-label">{scanLabel}</span>
            {progress && (
              <span className="statusbar-path">{progress.filePath}</span>
            )}
          </div>
          {progress && (
            <div className="statusbar-progress">
              <div className="progress-bar" style={{ height: 3 }}>
                <div
                  className="progress-bar-fill"
                  style={{ width: `${scanPct}%` }}
                />
              </div>
            </div>
          )}
        </>
      )}
      {showImport && importProgress && (
        <>
          {showScan && <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 8px' }} />}
          <div className="statusbar-left">
            <div className="spinner" style={{ width: 12, height: 12 }} />
            <span className="statusbar-label">
              Importing: {importProgress.current}/{importProgress.total}
            </span>
            <span className="statusbar-path">{importProgress.filename}</span>
          </div>
          <div className="statusbar-progress">
            <div className="progress-bar" style={{ height: 3 }}>
              <div
                className="progress-bar-fill"
                style={{ width: `${importPct}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
