import { BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron'

export function windowChromeOptions(platform: NodeJS.Platform): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'> {
  return platform === 'win32'
    ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#0d1014', symbolColor: '#f3f5f0', height: 46 } }
    : { titleBarStyle: 'hiddenInset' }
}

export function registerWindowChromeIpc(): void {
  ipcMain.handle('window:titlebar-colors', (event, background: unknown, foreground: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || event.senderFrame !== event.sender.mainFrame) throw new Error('Unknown application window.')
    if (typeof background !== 'string' || typeof foreground !== 'string'
      || !/^#[\da-f]{6}$/i.test(background) || !/^#[\da-f]{6}$/i.test(foreground)) throw new Error('Invalid title bar colors.')
    if (process.platform === 'win32') window.setTitleBarOverlay({ color: background, symbolColor: foreground, height: 46 })
  })
}

export function attachWindowChrome(window: BrowserWindow): void {
  if (process.platform !== 'win32') return
  window.setMenuBarVisibility(false)
  // Keep the application menu installed for accelerators, but route menu-bar access to React.
  let altAlone = false
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Alt' && !input.control && !input.meta) {
      event.preventDefault()
      if (input.type === 'keyDown') altAlone = true
      else if (input.type === 'keyUp' && altAlone) {
        altAlone = false
        window.webContents.send('menu:focus', null)
      }
      return
    }
    if (input.type !== 'keyDown') return
    altAlone = false
    if (input.key === 'F10' && !input.shift && !input.control && !input.alt && !input.meta) {
      event.preventDefault()
      window.webContents.send('menu:focus', null)
    } else if (input.alt && !input.control && !input.meta && /^[fevw]$/i.test(input.key)) {
      event.preventDefault()
      window.webContents.send('menu:focus', { f: 'File', e: 'Edit', v: 'View', w: 'Window' }[input.key.toLowerCase()])
    }
  })
}
