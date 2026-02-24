import { ipcMain } from 'electron'
import Store from 'electron-store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _store: any = null

function getStore(): Store {
  if (!_store) {
    _store = new Store({
      name: 'settings',
      defaults: {
        rootFolder: null as string | null,
        theme: 'dark',
        cachePath: '',
        thumbnailSize: 400,
        darkTempTolerance: 2,
        autoScanOnStartup: true
      }
    })
  }
  return _store as Store
}

// Proxy object so importing modules can use store.get / store.set
// without worrying about initialization timing
export const store = {
  get(key: string, defaultValue?: unknown): unknown {
    return getStore().get(key, defaultValue as never)
  },
  set(key: string, value: unknown): void {
    getStore().set(key, value)
  },
  get store(): Record<string, unknown> {
    return getStore().store as Record<string, unknown>
  }
}

export function registerSettingsHandler(): void {
  // Force store initialization now that app is ready
  getStore()

  ipcMain.handle('settings:get', (_event, key: string) => {
    return getStore().get(key)
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    getStore().set(key, value)
  })

  ipcMain.handle('settings:getAll', () => {
    return getStore().store
  })
}
