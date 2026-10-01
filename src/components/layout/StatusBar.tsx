import { useState } from 'react'
import { X, Clock, ChevronUp, ChevronDown } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { buildOperations, progressFraction, summarize } from '../../lib/operations'
import { OperationsPopover, ProgressBar } from './OperationsPopover'

export function StatusBar() {
  const importQueue = useAppStore((s) => s.importQueue)
  const isScanning = useAppStore((s) => s.isScanning)
  const scanProgress = useAppStore((s) => s.scanProgress)
  const isAnalyzing = useAppStore((s) => s.isAnalyzing)
  const analyzeProgress = useAppStore((s) => s.analyzeProgress)
  const importBatch = useAppStore((s) => s.importBatch)
  const importNotice = useAppStore((s) => s.importNotice)
  const setImportNotice = useAppStore((s) => s.setImportNotice)
  const [open, setOpen] = useState(false)

  const ops = buildOperations({ importQueue, isScanning, scanProgress, isAnalyzing, analyzeProgress })
  const { primary, othersRunning, queued, batch } = summarize(ops, importBatch)

  // Close when the last operation finishes, so new work doesn't pop it open again.
  if (open && !primary) setOpen(false)

  if (!primary && !importNotice) return null

  return (
    <div className="app-statusbar">
      {primary && (
        <button
          type="button"
          className="statusbar-ops"
          aria-expanded={open}
          aria-haspopup="dialog"
          title="Show operations"
          onClick={() => setOpen((o) => !o)}
        >
          {primary.status === 'running'
            ? <div className="spinner" style={{ width: 12, height: 12 }} />
            : <Clock size={12} className="statusbar-icon" />}
          <span className="statusbar-ops-title">{primary.title}</span>
          {primary.status === 'running' && primary.total != null && (
            <span className="statusbar-count">{primary.current ?? 0}/{primary.total}</span>
          )}
          <ProgressBar fraction={progressFraction(primary)} className="statusbar-progress" />
          {batch && <span className="statusbar-count">op {batch.position}/{batch.total}</span>}
          {queued > 0 && <span className="statusbar-count">{queued} queued</span>}
          {othersRunning > 0 && <span className="statusbar-count">+{othersRunning} running</span>}
          {open ? <ChevronDown size={12} className="statusbar-icon" /> : <ChevronUp size={12} className="statusbar-icon" />}
        </button>
      )}
      {open && primary && (
        <OperationsPopover operations={ops} batch={importBatch} onClose={() => setOpen(false)} />
      )}
      {importNotice && (
        <div className="statusbar-notice">
          <span className="statusbar-error" title={importNotice}>{importNotice}</span>
          <button className="btn btn-sm" onClick={() => setImportNotice(null)} title="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
