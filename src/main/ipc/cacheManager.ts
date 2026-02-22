import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { store } from './settingsHandler'

function getCacheFilePath(): string | null {
  const rootFolder = store.get('rootFolder') as string | null
  if (!rootFolder) return null
  return path.join(rootFolder, 'AstroSessionManagerDb.json')
}

export function registerCacheManager(): void {
  ipcMain.handle('cache:save', async (_event, data: {
    scanResult?: unknown
    mastersLibrary?: unknown
    fwhmData?: Record<string, number>
    thumbnailPaths?: Record<string, string>
  }) => {
    const filePath = getCacheFilePath()
    if (!filePath) return

    // Merge with existing cache to avoid wiping fields not included in this save
    let existing: Record<string, unknown> = {}
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      existing = JSON.parse(content)
    } catch {
      // No existing cache
    }

    const merged = { ...existing, ...data }
    await fs.promises.writeFile(filePath, JSON.stringify(merged, null, 2), 'utf-8')
    console.log('[cache] saved keys:', Object.keys(data).join(', '), '→', filePath)
  })

  ipcMain.handle('cache:load', async () => {
    const filePath = getCacheFilePath()
    if (!filePath) return null
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(content)
      console.log('[cache] loaded keys:', Object.keys(parsed).join(', '), 'from', filePath)
      return parsed
    } catch {
      console.log('[cache] no cache file at', filePath)
      return null
    }
  })
}
