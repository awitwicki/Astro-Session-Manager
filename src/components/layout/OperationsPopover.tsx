import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { X } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { progressFraction, type ImportBatch, type Operation } from '../../lib/operations'

export function ProgressBar({ fraction, className }: Readonly<{ fraction: number | null; className?: string }>) {
  const classes = ['progress-bar', fraction == null && 'progress-bar-indeterminate', className].filter(Boolean).join(' ')
  return (
    <div className={classes} style={{ height: 3 }}>
      <div className="progress-bar-fill" style={fraction == null ? undefined : { width: `${fraction * 100}%` }} />
    </div>
  )
}

// Running import: abort the copy and drop the job (files already copied stay).
// Queued import: just drop it. Scan / analysis: ask the backend to stop.
function stopOperation(op: Operation) {
  if (op.kind === 'import') {
    if (op.status === 'running') invoke('cancel_operation', { operation: 'import' }).catch(() => {})
    useAppStore.getState().cancelImport(op.id)
  } else {
    invoke('cancel_operation', { operation: op.kind }).catch(() => {})
  }
}

function cancelAll(ops: readonly Operation[]) {
  useAppStore.getState().cancelAllQueuedImports()
  for (const op of ops) {
    if (op.status === 'running') stopOperation(op)
  }
}

function OperationRow({ op }: Readonly<{ op: Operation }>) {
  const running = op.status === 'running'
  let count = ''
  if (running) count = op.total != null ? `${op.current ?? 0}/${op.total}` : '…'
  else if (op.total != null) count = `${op.total} files`
  return (
    <div className="ops-row">
      <div className="ops-row-main">
        <span className="ops-row-title" title={op.title}>{op.title}</span>
        <span className="statusbar-count">{count}</span>
        <button
          type="button"
          className="ops-row-x"
          title={running ? 'Stop' : 'Skip'}
          aria-label={`${running ? 'Stop' : 'Skip'} ${op.title}`}
          onClick={() => stopOperation(op)}
        >
          <X size={12} />
        </button>
      </div>
      {running && (
        <div className="ops-row-sub">
          <ProgressBar fraction={progressFraction(op)} className="ops-row-progress" />
          {op.detail && <span className="statusbar-path">{op.detail}</span>}
        </div>
      )}
    </div>
  )
}

export function OperationsPopover({ operations, batch, onClose }: Readonly<{
  operations: readonly Operation[]
  batch: ImportBatch
  onClose: () => void
}>) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // The status-line button toggles the popup itself; ignore clicks on it here.
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element
      if (ref.current?.contains(target) || target.closest?.('.statusbar-ops')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const running = operations.filter((o) => o.status === 'running')
  const queued = operations.filter((o) => o.status === 'queued')

  return (
    <div className="ops-popover" ref={ref} role="dialog" aria-label="Operations">
      <div className="ops-header">
        <span>Operations{batch.total > 0 && ` · ${batch.done} of ${batch.total} done`}</span>
        <button type="button" className="btn btn-sm" onClick={() => cancelAll(operations)}>Cancel all</button>
      </div>
      <div className="ops-list">
        {running.length > 0 && (
          <>
            <div className="ops-section-label">Running</div>
            {running.map((op) => <OperationRow key={op.id} op={op} />)}
          </>
        )}
        {queued.length > 0 && (
          <>
            <div className="ops-section-label">Queued</div>
            {queued.map((op) => <OperationRow key={op.id} op={op} />)}
          </>
        )}
      </div>
    </div>
  )
}
