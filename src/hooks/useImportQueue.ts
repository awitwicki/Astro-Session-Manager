import { useEffect, useRef, useReducer } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../store/appStore'
import type { CopyResult } from '../types/importSource'

export function useImportQueue() {
  const importQueue = useAppStore((s) => s.importQueue)
  const updateImportProgress = useAppStore((s) => s.updateImportProgress)
  const completeImport = useAppStore((s) => s.completeImport)
  const failImport = useAppStore((s) => s.failImport)
  const setImportNotice = useAppStore((s) => s.setImportNotice)
  const isProcessingRef = useRef(false)
  const [tick, forceUpdate] = useReducer((x: number) => x + 1, 0)

  const activeJob = importQueue.find((j) => j.status === 'active')
  const nextQueued = importQueue.find((j) => j.status === 'queued')

  // Listen to import:progress events for UI updates
  useEffect(() => {
    const unlisten = listen<{ current: number; total: number; filename: string }>(
      'import:progress',
      (event) => {
        updateImportProgress(
          event.payload.current,
          event.payload.total,
          event.payload.filename
        )
      }
    )
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [updateImportProgress])

  // Process queue: start next job when no active job exists
  useEffect(() => {
    if (activeJob || !nextQueued || isProcessingRef.current) return

    isProcessingRef.current = true
    const jobId = nextQueued.id
    const targetDir = nextQueued.targetDir
    const label = nextQueued.label
    const total = nextQueued.files.length

    // Mark the job as active
    useAppStore.setState((state) => ({
      importQueue: state.importQueue.map((j) =>
        j.id === jobId ? { ...j, status: 'active' as const } : j
      ),
    }))

    // Run the import and await the Promise for sequencing
    invoke<CopyResult>('copy_to_directory', {
      files: nextQueued.files,
      targetDir: nextQueued.targetDir,
    })
      .then((result) => {
        const stillQueued = useAppStore.getState().importQueue.some((j) => j.id === jobId)
        if (!stillQueued) return // cancelled
        completeImport()
        if (result.failed.length > 0) {
          const done = result.copied.length + result.skipped.length
          setImportNotice(`${label}: imported ${done}/${total}, ${result.failed.length} failed — ${result.failed[0].error}`)
        }
      })
      .catch((err) => {
        const stillQueued = useAppStore.getState().importQueue.some((j) => j.id === jobId)
        if (!stillQueued) return
        failImport(`${label}: ${String(err)}`)
      })
      .finally(() => {
        isProcessingRef.current = false
        const project = useAppStore.getState().projects.find((p) => targetDir.startsWith(p.path))
        if (project) {
          invoke('scan_single_project', { projectPath: project.path })
            .then((result) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              useAppStore.getState().mergeProjectScan(result as any)
            })
            .catch(() => {})
        }
        // Force re-render so the effect re-evaluates and picks up the next queued job
        // (needed when active job was cancelled — cancelImport removed it from queue
        // while isProcessingRef was still true, so the effect skipped)
        forceUpdate()
      })
  }, [activeJob, nextQueued, completeImport, failImport, setImportNotice, tick])
}
