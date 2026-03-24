import { useEffect, useRef, useReducer } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../store/appStore'

export function useImportQueue() {
  const importQueue = useAppStore((s) => s.importQueue)
  const updateImportProgress = useAppStore((s) => s.updateImportProgress)
  const completeImport = useAppStore((s) => s.completeImport)
  const failImport = useAppStore((s) => s.failImport)
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

    // Mark the job as active
    useAppStore.setState((state) => ({
      importQueue: state.importQueue.map((j) =>
        j.id === jobId ? { ...j, status: 'active' as const } : j
      ),
    }))

    // Run the import and await the Promise for sequencing
    invoke('copy_to_directory', {
      files: nextQueued.files,
      targetDir: nextQueued.targetDir,
    })
      .then(() => {
        // Check if the job was already cancelled (removed from queue)
        const currentQueue = useAppStore.getState().importQueue
        const jobStillExists = currentQueue.some((j) => j.id === jobId)
        if (!jobStillExists) return // was cancelled, skip cleanup

        completeImport()

        // Trigger rescan for the project that contains this targetDir
        const projects = useAppStore.getState().projects
        const project = projects.find((p) => targetDir.startsWith(p.path))
        if (project) {
          invoke('scan_single_project', { projectPath: project.path })
            .then((result) => {
              useAppStore.getState().mergeProjectScan(
                result as { rootPath: string; projects: unknown[]; projectHeaders: Record<string, unknown>; scanDurationMs: number }
              )
            })
            .catch(() => {})
        }
      })
      .catch((err) => {
        // Check if the job was already cancelled
        const currentQueue = useAppStore.getState().importQueue
        const jobStillExists = currentQueue.some((j) => j.id === jobId)
        if (!jobStillExists) return

        failImport(String(err))
      })
      .finally(() => {
        isProcessingRef.current = false
        // Force re-render so the effect re-evaluates and picks up the next queued job
        // (needed when active job was cancelled — cancelImport removed it from queue
        // while isProcessingRef was still true, so the effect skipped)
        forceUpdate()
      })
  }, [activeJob, nextQueued, completeImport, failImport, tick])
}
