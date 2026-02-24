import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../store/appStore'

interface ThumbnailProgressEvent {
  current: number
  total: number
  filePath: string
  thumbnailPath?: string
}

/**
 * Hook that processes the global thumbnail generation queue.
 * Mount once in AppShell — it watches the queue and processes items sequentially.
 * Each thumbnail is shown immediately as it's generated via progress events.
 */
export function useThumbnailQueueProcessor() {
  const processingRef = useRef(false)

  const queue = useAppStore((s) => s.thumbnailQueue)
  const processing = useAppStore((s) => s.thumbnailProcessing)

  useEffect(() => {
    if (processing || queue.length === 0 || processingRef.current) return

    const item = queue[0]
    if (!item || item.files.length === 0) {
      // Empty batch — skip it
      useAppStore.getState().completeThumbnailBatch()
      return
    }

    processingRef.current = true
    useAppStore.getState().startThumbnailProcessing(item.label)

    let unlisten: (() => void) | null = null

    async function process() {
      unlisten = await listen<ThumbnailProgressEvent>('thumbnail:progress', (event) => {
        const { current, total, filePath, thumbnailPath } = event.payload
        useAppStore.getState().setThumbnailQueueProgress(current, total)

        // Show thumbnail immediately as it's generated
        if (thumbnailPath) {
          useAppStore.getState().setThumbnailPath(filePath, thumbnailPath)
        }
      })

      try {
        const results = await invoke<Record<string, { thumbnailPath: string; fwhm?: number }>>(
          'batch_generate_thumbnails',
          { filePaths: item.files }
        )

        // Ensure all results are in the store (in case any events were missed)
        const state = useAppStore.getState()
        for (const [filePath, result] of Object.entries(results)) {
          if (result.thumbnailPath && !state.thumbnailPaths[filePath]) {
            state.setThumbnailPath(filePath, result.thumbnailPath)
          }
          if (result.fwhm != null) {
            state.setFwhm(filePath, result.fwhm)
          }
        }

        // Save cache
        try {
          const rootFolder = useAppStore.getState().rootFolder
          if (rootFolder) {
            const s = useAppStore.getState()
            await invoke('save_cache', {
              rootFolder,
              data: { fwhmData: s.fwhmData, thumbnailPaths: s.thumbnailPaths }
            })
          }
        } catch { /* best-effort */ }
      } finally {
        if (unlisten) unlisten()
        processingRef.current = false
        useAppStore.getState().completeThumbnailBatch()
      }
    }

    process()
  }, [queue.length, processing])
}
