import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

type SendMenuCommand = (command: MenuCommand) => void

/**
 * Builds the application menu. File items only send commands; the renderer's
 * query workspace decides what each command does.
 */
export function buildMenuTemplate(platform: NodeJS.Platform, send: SendMenuCommand): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin'
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { label: 'New Query', accelerator: 'CmdOrCtrl+N', click: () => send('new-query') },
      { label: 'Open SQL File…', accelerator: 'CmdOrCtrl+O', click: () => send('open-file') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
      { type: 'separator' },
      // Cmd+W closes the active query tab (see index.ts), so this item carries no accelerator.
      isMac ? { label: 'Close Window', click: (_item, window) => window?.close() } : { role: 'quit' }
    ]
  }

  return [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    fileMenu,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    // Ctrl+W belongs to query tabs; Alt+F4 remains the Windows close-window shortcut.
    platform === 'win32'
      ? { role: 'windowMenu', submenu: [{ role: 'minimize' }, { role: 'close', accelerator: 'Alt+F4' }] }
      : { role: 'windowMenu' }
  ]
}
