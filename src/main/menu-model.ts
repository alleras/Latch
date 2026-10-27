import type { Menu, MenuItem } from 'electron'
import type { ApplicationMenuItem } from '../shared/types'

const roleAccelerators: Record<string, string> = {
  undo: 'Ctrl+Z', redo: 'Ctrl+Y', cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V',
  selectall: 'Ctrl+A', reload: 'Ctrl+R', forcereload: 'Ctrl+Shift+R',
  toggledevtools: 'Ctrl+Shift+I', resetzoom: 'Ctrl+0', zoomin: 'Ctrl+Plus',
  zoomout: 'Ctrl+-', togglefullscreen: 'F11', minimize: 'Ctrl+M', close: 'Alt+F4'
}

/** A serializable view of the same native items that own keyboard accelerators and actions. */
export function readMenuModel(menu: Pick<Menu, 'items'>): ApplicationMenuItem[] {
  return menu.items.filter((item) => item.visible).map((item) => ({
    id: item.commandId,
    label: item.label.replace(/&&|&/g, (match) => match === '&&' ? '&' : ''),
    type: item.type,
    enabled: item.enabled,
    checked: item.checked,
    accelerator: item.accelerator ?? roleAccelerators[item.role?.toLowerCase() ?? ''],
    ...(item.submenu ? { submenu: readMenuModel(item.submenu) } : {})
  }))
}

/** Hidden or disabled parents also prevent invoking their descendants through IPC. */
export function findExecutableMenuItem(menu: Pick<Menu, 'items'>, id: number): MenuItem | undefined {
  for (const item of menu.items) {
    if (!item.visible || !item.enabled) continue
    if (item.submenu) {
      const found = findExecutableMenuItem(item.submenu, id)
      if (found) return found
    } else if (item.commandId === id && item.type !== 'separator') {
      return item
    }
  }
  return undefined
}
