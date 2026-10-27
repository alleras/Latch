import { BrowserWindow, ipcMain, Menu } from 'electron'
import type { MenuCommand } from '../shared/types'
import { buildMenuTemplate } from './menu-template'
import { findExecutableMenuItem, readMenuModel } from './menu-model'

function sendMenuCommand(command: MenuCommand): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  window?.webContents.send('menu:command', command)
}

export function installApplicationMenu(): void {
  const menu = Menu.buildFromTemplate(buildMenuTemplate(process.platform, sendMenuCommand))
  Menu.setApplicationMenu(menu)
  ipcMain.handle('menu:read', () => readMenuModel(menu))
  ipcMain.handle('menu:execute', (event, id: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || event.senderFrame !== event.sender.mainFrame || typeof id !== 'number') throw new Error('Invalid menu command.')
    const item = findExecutableMenuItem(menu, id)
    if (!item) throw new Error('Menu command is unavailable.')
    // Electron's click wrapper executes built-in roles as well as our File callbacks.
    item.click({}, window, window.webContents)
  })
}
