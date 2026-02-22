import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

function getCacheFilePath(): string {
  return path.join(app.getPath('userData'), 'app-cache', 'app-state.json')
}

export function registerCacheManager(): void {
  ipcMain.handle('cache:save', async (_event, data: {
    scanResult?: unknown
    mastersLibrary?: unknown
    fwhmData?: Record<string, number>
    thumbnailPaths?: Record<string, string>
  }) => {
    const filePath = getCacheFilePath()
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })

    // Merge with existing cache to avoid wiping fields not included in this save
    let existing: Record<string, unknown> = {}
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      existing = JSON.parse(content)
    } catch {
      // No existing cache
    }

    const merged = { ...existing, ...data }
    await fs.promises.writeFile(filePath, JSON.stringify(merged), 'utf-8')
    console.log('[cache] saved keys:', Object.keys(data).join(', '), '→', filePath)
  })

  ipcMain.handle('cache:load', async () => {
    const filePath = getCacheFilePath()
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
