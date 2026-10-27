import { BrowserWindow, Menu } from 'electron'
import type { MenuCommand } from '../shared/types'
import { buildMenuTemplate } from './menu-template'

function sendMenuCommand(command: MenuCommand): void {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  window?.webContents.send('menu:command', command)
}

export function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(process.platform, sendMenuCommand)))
}
