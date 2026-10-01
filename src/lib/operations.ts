// Unified view of the long-running work shown in the status bar — the import
// queue, the project scan and sub analysis. Pure: StatusBar and
// OperationsPopover render what buildOperations / summarize return.
import type { ImportJob } from '../store/appStore'

export type OperationKind = 'import' | 'analyze' | 'scan'

export interface Operation {
  id: string // import job id, or 'scan' / 'analyze'
  kind: OperationKind
  title: string
  status: 'running' | 'queued'
  current?: number // files done, running only
  total?: number // running: files to do; queued import: its file count
  detail?: string // file currently being processed (popup only)
}

export interface ScanProgress {
  phase: string
  current: number
  total: number
  filePath: string
}

export interface AnalyzeProgress {
  current: number
  total: number
  filePath: string
}

// Position in the current burst of imports: `done` jobs left the queue
// (completed, failed, stopped or skipped) out of `total` enqueued since the
// queue was last empty.
export interface ImportBatch {
  done: number
  total: number
}

export const EMPTY_BATCH: ImportBatch = { done: 0, total: 0 }

export function batchEnqueued(batch: ImportBatch): ImportBatch {
  return { done: batch.done, total: batch.total + 1 }
}

// `finished` jobs just left the queue; `remaining` are still in it.
export function batchFinished(batch: ImportBatch, finished: number, remaining: number): ImportBatch {
  if (remaining === 0) return EMPTY_BATCH
  return { done: Math.min(batch.done + finished, batch.total), total: batch.total }
}

export interface OperationsInput {
  importQueue: readonly ImportJob[]
  isScanning: boolean
  scanProgress: ScanProgress | null
  isAnalyzing: boolean
  analyzeProgress: AnalyzeProgress | null
}

export function scanTitle(progress: ScanProgress | null): string {
  if (progress?.phase === 'scanning') return 'Scanning projects'
  if (progress?.phase === 'headers') return 'Reading headers'
  return 'Synchronizing'
}

// Running operations first (import, scan, analysis), then queued imports in
// queue order — so the first entry is always the one the status line shows.
export function buildOperations(input: OperationsInput): Operation[] {
  const ops: Operation[] = []
  const active = input.importQueue.find((j) => j.status === 'active')
  if (active) {
    ops.push({
      id: active.id,
      kind: 'import',
      title: `Importing ${active.label}`,
      status: 'running',
      current: active.current,
      total: active.total,
      ...(active.filename ? { detail: active.filename } : {}),
    })
  }
  if (input.isScanning) {
    const p = input.scanProgress
    ops.push({
      id: 'scan',
      kind: 'scan',
      title: scanTitle(p),
      status: 'running',
      ...(p ? { current: p.current, total: p.total, detail: p.filePath } : {}),
    })
  }
  if (input.isAnalyzing) {
    const p = input.analyzeProgress
    ops.push({
      id: 'analyze',
      kind: 'analyze',
      title: 'Analyzing subs',
      status: 'running',
      ...(p ? { current: p.current, total: p.total, detail: p.filePath } : {}),
    })
  }
  for (const j of input.importQueue) {
    if (j.status === 'queued') {
      ops.push({ id: j.id, kind: 'import', title: `Importing ${j.label}`, status: 'queued', total: j.total })
    }
  }
  return ops
}

export interface OperationsSummary {
  primary: Operation | null
  othersRunning: number // running operations besides the primary
  queued: number
  batch: { position: number; total: number } | null // "op 3/7"
}

export function summarize(ops: readonly Operation[], batch: ImportBatch): OperationsSummary {
  const primary = ops[0] ?? null
  const running = ops.filter((o) => o.status === 'running').length
  const importRunning = ops.some((o) => o.kind === 'import' && o.status === 'running')
  return {
    primary,
    othersRunning: primary?.status === 'running' ? running - 1 : running,
    queued: ops.filter((o) => o.status === 'queued').length,
    batch: importRunning && batch.total > 1
      ? { position: Math.min(batch.done + 1, batch.total), total: batch.total }
      : null,
  }
}

// null → indeterminate bar (no total yet, or a queued job).
export function progressFraction(op: Operation): number | null {
  if (op.status !== 'running' || !op.total) return null
  return Math.min(1, (op.current ?? 0) / op.total)
}
