import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Menu, MenuItem } from 'electron'
import { findExecutableMenuItem, readMenuModel } from '../src/main/menu-model.ts'

let nextId = 0
function item(overrides: Partial<MenuItem> = {}): MenuItem {
  return { commandId: ++nextId, label: 'Action', type: 'normal', visible: true, enabled: true, checked: false, ...overrides } as MenuItem
}
function menu(...items: MenuItem[]): Menu {
  return { items } as Menu
}

test('menu model preserves native action IDs, shortcuts and checked/disabled state without functions', () => {
  const save = item({ label: '&Save', accelerator: 'CmdOrCtrl+S', click: () => {} })
  const checkbox = item({ type: 'checkbox', checked: true, enabled: false })
  const root = menu(item({ type: 'submenu', label: '&File', submenu: menu(save, checkbox, item({ visible: false })) }))
  const model = JSON.parse(JSON.stringify(readMenuModel(root)))
  assert.equal(model[0].label, 'File')
  assert.equal(model[0].submenu.length, 2)
  assert.deepEqual(model[0].submenu[0], { id: save.commandId, label: 'Save', type: 'normal', enabled: true, checked: false, accelerator: 'CmdOrCtrl+S' })
  assert.equal(model[0].submenu[1].checked, true)
  assert.equal(model[0].submenu[1].enabled, false)
})

test('menu labels remove mnemonics and preserve literal ampersands', () => {
  assert.deepEqual(readMenuModel(menu(item({ label: 'Rock && Roll' }), item({ label: '&File' }))).map((entry) => entry.label), ['Rock & Roll', 'File'])
})

test('native edit roles expose their keyboard hints', () => {
  assert.equal(readMenuModel(menu(item({ role: 'copy' })))[0].accelerator, 'Ctrl+C')
})

test('execution finds only visible enabled leaf actions', () => {
  const enabled = item()
  const disabled = item({ enabled: false })
  const hidden = item({ visible: false })
  const separator = item({ type: 'separator' })
  const child = item()
  const parent = item({ type: 'submenu', submenu: menu(child) })
  const root = menu(enabled, disabled, hidden, separator, parent)
  assert.equal(findExecutableMenuItem(root, enabled.commandId), enabled)
  assert.equal(findExecutableMenuItem(root, child.commandId), child)
  for (const id of [disabled.commandId, hidden.commandId, separator.commandId, parent.commandId, -1]) {
    assert.equal(findExecutableMenuItem(root, id), undefined)
  }
  parent.enabled = false
  assert.equal(findExecutableMenuItem(root, child.commandId), undefined)
  parent.enabled = true
  parent.visible = false
  assert.equal(findExecutableMenuItem(root, child.commandId), undefined)
})
