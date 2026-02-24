import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { store } from './ipc/settingsHandler'

export function createWindow(): BrowserWindow {
  const bounds = store.get('windowBounds', {
    width: 1400,
    height: 900,
    x: undefined,
    y: undefined
  }) as { width: number; height: number; x?: number; y?: number }

  const mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Save window bounds on move/resize
  let boundsTimeout: NodeJS.Timeout | null = null
  const saveBounds = (): void => {
    if (boundsTimeout) clearTimeout(boundsTimeout)
    boundsTimeout = setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        store.set('windowBounds', mainWindow.getBounds())
      }
    }, 300)
  }

  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  // Notify renderer about fullscreen changes (for macOS traffic light padding)
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreenChanged', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreenChanged', false)
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}
