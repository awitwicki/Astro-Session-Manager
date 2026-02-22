import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  scanner: {
    selectRootFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('scanner:selectRootFolder'),
    scanRoot: (): Promise<unknown> => ipcRenderer.invoke('scanner:scanRoot'),
    onFileChanged: (callback: (_event: unknown, data: unknown) => void): (() => void) => {
      ipcRenderer.on('scanner:fileChanged', callback)
      return () => ipcRenderer.removeListener('scanner:fileChanged', callback)
    }
  },

  fits: {
    readHeader: (filePath: string): Promise<unknown> =>
      ipcRenderer.invoke('fits:readHeader', filePath),
    readPixelData: (
      filePath: string
    ): Promise<{ header: unknown; pixels: number[]; width: number; height: number }> =>
      ipcRenderer.invoke('fits:readPixelData', filePath),
    batchReadHeaders: (paths: string[]): Promise<unknown[]> =>
      ipcRenderer.invoke('fits:batchReadHeaders', paths)
  },

  xisf: {
    readHeader: (filePath: string): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('xisf:readHeader', filePath)
  },

  thumbnail: {
    generate: (filePath: string): Promise<{ thumbnailPath: string; fwhm: number | null }> =>
      ipcRenderer.invoke('thumbnail:generate', filePath),
    batchGenerate: (paths: string[]): Promise<Record<string, { thumbnailPath: string | null; fwhm: number | null }>> =>
      ipcRenderer.invoke('thumbnail:batchGenerate', paths),
    getCached: (filePath: string): Promise<{ thumbnailPath: string; fwhm: number | null } | null> =>
      ipcRenderer.invoke('thumbnail:getCached', filePath),
    getCacheSize: (): Promise<{ totalSize: number; fileCount: number; path: string }> =>
      ipcRenderer.invoke('thumbnail:getCacheSize'),
    clearCache: (): Promise<boolean> =>
      ipcRenderer.invoke('thumbnail:clearCache'),
    onProgress: (
      callback: (_event: unknown, data: { current: number; total: number }) => void
    ): (() => void) => {
      ipcRenderer.on('thumbnail:progress', callback)
      return () => ipcRenderer.removeListener('thumbnail:progress', callback)
    }
  },

  masters: {
    scan: (): Promise<unknown> => ipcRenderer.invoke('masters:scan'),
    findMatch: (query: {
      exposureTime: number
      ccdTemp: number
    }): Promise<unknown> => ipcRenderer.invoke('masters:findMatch', query),
    import: (options: {
      files: string[]
      type: 'darks' | 'biases'
      ccdTemp: number
    }): Promise<{ imported: number; files: string[] }> =>
      ipcRenderer.invoke('masters:import', options)
  },

  settings: {
    get: (key: string): Promise<unknown> => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke('settings:set', key, value),
    getAll: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('settings:getAll')
  },

  dialog: {
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
    openFiles: (options: {
      title?: string
      filters?: { name: string; extensions: string[] }[]
    }): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles', options)
  },

  file: {
    moveToTrash: (
      filePath: string
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:moveToTrash', filePath),
    copyToDirectory: (options: {
      files: string[]
      targetDir: string
    }): Promise<{ copied: number; files: string[] }> =>
      ipcRenderer.invoke('file:copyToDirectory', options),
    rename: (options: {
      oldPath: string
      newPath: string
    }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('file:rename', options)
  },

  session: {
    create: (options: {
      filterPath: string
      sessionName: string
    }): Promise<{ path: string }> =>
      ipcRenderer.invoke('session:create', options)
  },

  project: {
    create: (options: {
      projectName: string
      filters: string[]
    }): Promise<string> => ipcRenderer.invoke('project:create', options)
  },

  shell: {
    showInFolder: (folderPath: string): Promise<void> =>
      ipcRenderer.invoke('shell:showInFolder', folderPath)
  },

  window: {
    platform: process.platform,
    onFullscreenChanged: (callback: (_event: unknown, isFullscreen: boolean) => void): (() => void) => {
      ipcRenderer.on('window:fullscreenChanged', callback)
      return () => ipcRenderer.removeListener('window:fullscreenChanged', callback)
    }
  },

  cache: {
    save: (data: {
      scanResult?: unknown
      fwhmData?: Record<string, number>
      thumbnailPaths?: Record<string, string>
    }): Promise<void> =>
      ipcRenderer.invoke('cache:save', data),
    load: (): Promise<{
      scanResult?: unknown
      fwhmData?: Record<string, number>
      thumbnailPaths?: Record<string, string>
    } | null> =>
      ipcRenderer.invoke('cache:load')
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
