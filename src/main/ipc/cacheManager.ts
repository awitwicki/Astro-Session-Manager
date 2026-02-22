import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

function getCacheFilePath(): string {
  return path.join(app.getPath('userData'), 'cache', 'app-state.json')
}

export function registerCacheManager(): void {
  ipcMain.handle('cache:save', async (_event, data: {
    scanResult?: unknown
    fwhmData?: Record<string, number>
    thumbnailPaths?: Record<string, string>
  }) => {
    const filePath = getCacheFilePath()
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, JSON.stringify(data), 'utf-8')
  })

  ipcMain.handle('cache:load', async () => {
    const filePath = getCacheFilePath()
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  })
}
