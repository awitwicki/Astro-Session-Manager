import { app, BrowserWindow, protocol, net } from 'electron'
import { createWindow } from './window'
import { registerAllHandlers } from './ipc'

// Register custom protocol for serving local files (thumbnails) to renderer
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-resource',
    privileges: { bypassCSP: true, stream: true, supportFetchAPI: true }
  }
])

app.whenReady().then(() => {
  protocol.handle('local-resource', (request) => {
    return net.fetch(request.url.replace('local-resource://', 'file://'))
  })

  registerAllHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
