import { useState, useEffect, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { X, Clock } from 'lucide-react'
import { useAppStore } from '../../store/appStore'

interface ScanProgress {
  phase: string
  current: number
  total: number
  filePath: string
}

interface AnalyzeProgress {
  current: number
  total: number
  filePath: string
}

function CancelButton({ operation, onClick }: Readonly<{ operation?: string; onClick?: () => void }>) {
  const handleCancel = useCallback(() => {
    if (onClick) {
      onClick()
    } else if (operation) {
      invoke('cancel_operation', { operation }).catch(() => {})
    }
  }, [operation, onClick])

  return (
    <button
      onClick={handleCancel}
      title="Cancel"
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        color: 'var(--color-text-muted)',
        flexShrink: 0,
      }}
    >
      <X size={12} />
    </button>
  )
}

export function StatusBar() {
  const isScanning = useAppStore((s) => s.isScanning)
  const isAnalyzing = useAppStore((s) => s.isAnalyzing)
  const importQueue = useAppStore((s) => s.importQueue)
  const cancelImport = useAppStore((s) => s.cancelImport)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [analyzeProgress, setAnalyzeProgress] = useState<AnalyzeProgress | null>(null)

  const activeImport = importQueue.find((j) => j.status === 'active')
  const queuedImports = importQueue.filter((j) => j.status === 'queued')

  useEffect(() => {
    const unlisten = listen<ScanProgress>('scan:progress', (event) => {
      setProgress(event.payload)
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  // Listen for analyze progress events
  useEffect(() => {
    const unlisten = listen<AnalyzeProgress>('analyze:progress', (event) => {
      setAnalyzeProgress(event.payload)
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

  // Clear analyze progress when analysis finishes
  useEffect(() => {
    if (!isAnalyzing) {
      setAnalyzeProgress(null)
    }
  }, [isAnalyzing])

  const showScan = isScanning
  const showImport = activeImport != null || queuedImports.length > 0
  const showAnalyze = isAnalyzing

  if (!showScan && !showImport && !showAnalyze) return null

  const scanPct = progress ? (progress.current / progress.total) * 100 : 0
  const scanLabel =
    progress?.phase === 'scanning'
      ? `Scanning projects: ${progress.current}/${progress.total}`
      : progress?.phase === 'headers'
        ? `Reading headers: ${progress.current}/${progress.total}`
        : 'Synchronizing...'

  const importPct = activeImport ? (activeImport.current / activeImport.total) * 100 : 0
  const analyzePct = analyzeProgress ? (analyzeProgress.current / analyzeProgress.total) * 100 : 0

  const handleCancelActive = () => {
    if (activeImport) {
      invoke('cancel_operation', { operation: 'import' }).catch(() => {})
      cancelImport(activeImport.id)
    }
  }

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
          <CancelButton operation="scan" />
        </>
      )}
      {activeImport && (
        <>
          {showScan && <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 8px' }} />}
          <div className="statusbar-left">
            <div className="spinner" style={{ width: 12, height: 12 }} />
            <span className="statusbar-label">
              Importing: {activeImport.current}/{activeImport.total}
            </span>
            <span className="statusbar-path">{activeImport.filename}</span>
          </div>
          <div className="statusbar-progress">
            <div className="progress-bar" style={{ height: 3 }}>
              <div
                className="progress-bar-fill"
                style={{ width: `${importPct}%` }}
              />
            </div>
          </div>
          <CancelButton onClick={handleCancelActive} />
        </>
      )}
      {queuedImports.map((job) => (
        <div key={job.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {(showScan || activeImport || queuedImports[0] !== job) && (
            <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 8px' }} />
          )}
          <Clock size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <span className="statusbar-label" style={{ color: 'var(--color-text-muted)' }}>
            Queued: {job.label}
          </span>
          <CancelButton onClick={() => cancelImport(job.id)} />
        </div>
      ))}
      {showAnalyze && (
        <>
          {(showScan || showImport) && <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 8px' }} />}
          <div className="statusbar-left">
            <div className="spinner" style={{ width: 12, height: 12 }} />
            <span className="statusbar-label">
              Analyzing subs: {analyzeProgress ? `${analyzeProgress.current}/${analyzeProgress.total}` : '...'}
            </span>
            {analyzeProgress && (
              <span className="statusbar-path">{analyzeProgress.filePath}</span>
            )}
          </div>
          {analyzeProgress && (
            <div className="statusbar-progress">
              <div className="progress-bar" style={{ height: 3 }}>
                <div
                  className="progress-bar-fill"
                  style={{ width: `${analyzePct}%` }}
                />
              </div>
            </div>
          )}
          <CancelButton operation="analyze" />
        </>
      )}
    </div>
  )
}
