import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../store/appStore'

export function useThumbnail(filePath: string) {
  const cached = useAppStore((s) => s.thumbnailPaths[filePath])
  const setThumbnailPath = useAppStore((s) => s.setThumbnailPath)
  const setFwhm = useAppStore((s) => s.setFwhm)
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    if (cached) return

    let cancelled = false

    async function load(): Promise<void> {
      // First check if already cached on disk
      const existing = await invoke<{ thumbnailPath: string; fwhm?: number } | null>('get_cached_thumbnail', { filePath })
      if (cancelled) return

      if (existing) {
        setThumbnailPath(filePath, existing.thumbnailPath)
        if (existing.fwhm != null) {
          setFwhm(filePath, existing.fwhm)
        }
        return
      }

      // Generate
      setIsGenerating(true)
      try {
        const result = await invoke<{ thumbnailPath: string; fwhm?: number }>('generate_thumbnail', { filePath })
        if (!cancelled) {
          setThumbnailPath(filePath, result.thumbnailPath)
          if (result.fwhm != null) {
            setFwhm(filePath, result.fwhm)
          }
        }
      } catch {
        // Failed to generate
      } finally {
        if (!cancelled) setIsGenerating(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [filePath, cached, setThumbnailPath, setFwhm])

  return {
    thumbnailPath: cached ?? null,
    isGenerating
  }
}
