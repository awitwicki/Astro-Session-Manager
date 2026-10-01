import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../store/appStore'
import type { AnalyzeProgress, ScanProgress } from '../lib/operations'

// Feeds scan / analysis progress events into the store, where the status bar
// and the operations popup read them. Mounted once in AppShell.
export function useOperationProgress() {
  const setScanProgress = useAppStore((s) => s.setScanProgress)
  const setAnalyzeProgress = useAppStore((s) => s.setAnalyzeProgress)

  useEffect(() => {
    const unlisten = listen<ScanProgress>('scan:progress', (event) => {
      setScanProgress(event.payload)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [setScanProgress])

  useEffect(() => {
    const unlisten = listen<AnalyzeProgress>('analyze:progress', (event) => {
      setAnalyzeProgress(event.payload)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [setAnalyzeProgress])
}
