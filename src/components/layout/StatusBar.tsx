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
  const [progress, setProgress] = useState<ScanProgress | null>(null)

  useEffect(() => {
    const unlisten = listen<ScanProgress>('scan:progress', (event) => {
      setProgress(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  // Clear progress when scan finishes
  useEffect(() => {
    if (!isScanning) {
      setProgress(null)
    }
  }, [isScanning])

  if (!isScanning) return null

  const pct = progress ? (progress.current / progress.total) * 100 : 0
  const label =
    progress?.phase === 'scanning'
      ? `Scanning projects: ${progress.current}/${progress.total}`
      : progress?.phase === 'headers'
        ? `Reading headers: ${progress.current}/${progress.total}`
        : 'Synchronizing...'

  return (
    <div className="app-statusbar">
      <div className="statusbar-left">
        <div className="spinner" style={{ width: 12, height: 12 }} />
        <span className="statusbar-label">{label}</span>
        {progress && (
          <span className="statusbar-path">{progress.filePath}</span>
        )}
      </div>
      {progress && (
        <div className="statusbar-progress">
          <div className="progress-bar" style={{ height: 3 }}>
            <div
              className="progress-bar-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
