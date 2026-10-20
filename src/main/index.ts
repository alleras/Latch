import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { flushDraftBackups } from './draft-backups'
import { registerIpc } from './ipc'
import { installApplicationMenu } from './menu'
import { closeAllProviderConnections } from './providers'

const windows = new Set<BrowserWindow>()

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0e0f11',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  windows.add(window)
  window.on('closed', () => windows.delete(window))
  window.once('ready-to-show', () => window.show())
  window.webContents.on('before-input-event', (event, input) => {
    const closeTabShortcut = input.type === 'keyDown'
      && (input.meta || input.control)
      && !input.shift
      && !input.alt
      && input.key.toLocaleLowerCase() === 'w'
    if (!closeTabShortcut) return
    event.preventDefault()
    window.webContents.send('tabs:close-active')
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  installApplicationMenu()
  createWindow()
  app.on('activate', () => {
    if (windows.size === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let closingSessions = false
let sessionsClosed = false
app.on('before-quit', (event) => {
  if (sessionsClosed) return
  event.preventDefault()
  if (closingSessions) return
  closingSessions = true
  // Unsaved-edit backups still being written must land before the process exits.
  void Promise.all([
    closeAllProviderConnections().catch((error: unknown) => console.error('Failed to close database sessions.', error)),
    flushDraftBackups()
  ]).finally(() => {
      sessionsClosed = true
      app.quit()
    })
})
