import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { store } from './settingsHandler'

export function registerDialogHandler(): void {
  ipcMain.handle('dialog:openFolder', async () => {
    const window = BrowserWindow.getFocusedWindow()
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select Astrophotography Root Folder'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folderPath = result.filePaths[0]
    store.set('rootFolder', folderPath)
    return folderPath
  })

  ipcMain.handle('dialog:openFiles', async (_event, options: {
    title?: string
    filters?: { name: string; extensions: string[] }[]
  }) => {
    const window = BrowserWindow.getFocusedWindow()
    if (!window) return []

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      title: options.title || 'Select Files',
      filters: options.filters || [
        { name: 'FITS files', extensions: ['fits', 'fit', 'fts'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })

    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('file:copyToDirectory', async (_event, options: {
    files: string[]
    targetDir: string
  }) => {
    await fs.promises.mkdir(options.targetDir, { recursive: true })

    const copied: string[] = []
    for (const filePath of options.files) {
      const filename = path.basename(filePath)
      const target = path.join(options.targetDir, filename)
      try {
        await fs.promises.copyFile(filePath, target)
        copied.push(target)
      } catch { /* skip */ }
    }
    return { copied: copied.length, files: copied }
  })

  ipcMain.handle('project:create', async (_event, options: {
    projectName: string
    filters: string[]
  }) => {
    const rootFolder = store.get('rootFolder') as string | null
    if (!rootFolder) throw new Error('No root folder configured')

    const projectDir = path.join(rootFolder, options.projectName)
    await fs.promises.mkdir(projectDir, { recursive: true })

    for (const filterName of options.filters) {
      const filterDir = path.join(projectDir, filterName)
      await fs.promises.mkdir(path.join(filterDir, 'night1', 'lights'), { recursive: true })
      await fs.promises.mkdir(path.join(filterDir, 'night1', 'flats'), { recursive: true })
    }
    return projectDir
  })

  ipcMain.handle('session:create', async (_event, options: {
    filterPath: string
    sessionName: string
  }) => {
    const rootFolder = store.get('rootFolder') as string | null
    if (!rootFolder) throw new Error('No root folder configured')

    const resolvedFilter = path.resolve(options.filterPath)
    const resolvedRoot = path.resolve(rootFolder)
    if (!resolvedFilter.startsWith(resolvedRoot)) {
      throw new Error('Path must be within the root folder')
    }

    const sessionDir = path.join(resolvedFilter, options.sessionName)
    await fs.promises.mkdir(path.join(sessionDir, 'lights'), { recursive: true })
    await fs.promises.mkdir(path.join(sessionDir, 'flats'), { recursive: true })
    return { path: sessionDir }
  })

  ipcMain.handle('file:moveToTrash', async (_event, filePath: string) => {
    try {
      await shell.trashItem(filePath)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('shell:showInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('file:rename', async (_event, options: {
    oldPath: string
    newPath: string
  }) => {
    const rootFolder = store.get('rootFolder') as string | null
    if (!rootFolder) throw new Error('No root folder configured')

    // Security: both paths must be under rootFolder
    const resolvedOld = path.resolve(options.oldPath)
    const resolvedNew = path.resolve(options.newPath)
    const resolvedRoot = path.resolve(rootFolder)
    if (!resolvedOld.startsWith(resolvedRoot) || !resolvedNew.startsWith(resolvedRoot)) {
      throw new Error('Paths must be within the root folder')
    }

    // Check source exists
    await fs.promises.access(resolvedOld)
    // Check target doesn't exist
    try {
      await fs.promises.access(resolvedNew)
      throw new Error('Target already exists')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }

    await fs.promises.rename(resolvedOld, resolvedNew)
    return { success: true }
  })
}
