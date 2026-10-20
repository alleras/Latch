import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../src/shared/types.ts'
import { buildMenuTemplate } from '../src/main/menu-template.ts'

const noop = (): void => {}
const labels = (items: MenuItemConstructorOptions[]): (string | undefined)[] => items.map((item) => item.label ?? item.role)
const fileMenu = (platform: NodeJS.Platform, send: (command: MenuCommand) => void = noop): MenuItemConstructorOptions[] => {
  const template = buildMenuTemplate(platform, send)
  const file = template.find((item) => item.label === 'File')
  assert.ok(file, 'template has a File menu')
  return file.submenu as MenuItemConstructorOptions[]
}

test('darwin template starts with appMenu then File', () => {
  const template = buildMenuTemplate('darwin', noop)
  assert.equal(template[0].role, 'appMenu')
  assert.equal(template[1].label, 'File')
})

test('win32 template starts with File and has no appMenu', () => {
  const template = buildMenuTemplate('win32', noop)
  assert.equal(template[0].label, 'File')
  assert.equal(template.some((item) => item.role === 'appMenu'), false)
})

test('File menu items and accelerators', () => {
  const file = fileMenu('win32')
  assert.deepEqual(file.filter((item) => item.label).map((item) => [item.label, item.accelerator]), [
    ['New Query', 'CmdOrCtrl+N'],
    ['Open SQL File…', 'CmdOrCtrl+O'],
    ['Save', 'CmdOrCtrl+S'],
    ['Save As…', 'CmdOrCtrl+Shift+S']
  ])
  assert.equal(file.at(-1)?.role, 'quit')
})

test('linux File menu also ends with quit', () => {
  assert.equal(fileMenu('linux').at(-1)?.role, 'quit')
})

test('darwin File menu ends with a Close Window item that has no accelerator', () => {
  const last = fileMenu('darwin').at(-1)
  assert.equal(last?.label, 'Close Window')
  assert.equal(last?.role, undefined)
  assert.equal(last?.accelerator, undefined)
  assert.equal(typeof last?.click, 'function')
})

test('clicking each File item sends its command', () => {
  const sent: MenuCommand[] = []
  const file = fileMenu('linux', (command) => sent.push(command))
  for (const item of file) {
    if (item.label && item.click) (item.click as () => void)()
  }
  assert.deepEqual(sent, ['new-query', 'open-file', 'save', 'save-as'])
})

test('Edit, View and Window roles are present', () => {
  assert.deepEqual(labels(buildMenuTemplate('linux', noop)).slice(1), ['editMenu', 'viewMenu', 'windowMenu'])
  assert.deepEqual(labels(buildMenuTemplate('darwin', noop)).slice(2), ['editMenu', 'viewMenu', 'windowMenu'])
})
