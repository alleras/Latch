// Runs the actual production main/preload/renderer bundles inside Electron on Windows.
const { app, BrowserWindow, clipboard, dialog } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (process.platform !== 'win32') throw new Error('This test requires Windows.')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'latch-chrome-test-')))
const screenshotDirectory = path.resolve('release')
fs.mkdirSync(screenshotDirectory, { recursive: true })
let fileDialogs = 0
dialog.showOpenDialog = async () => { fileDialogs++; return { canceled: true, filePaths: [] } }
const timeout = setTimeout(() => { console.error('Window chrome test timed out.'); app.exit(1) }, 90000)

app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', () => {
    void testChrome(window).then(() => { clearTimeout(timeout); app.exit(0) }).catch(async (error) => {
      console.error(error)
      try { fs.writeFileSync(path.join(screenshotDirectory, 'window-chrome-failure.png'), (await window.capturePage()).toPNG()) } catch {}
      clearTimeout(timeout)
      app.exit(1)
    })
  })
})

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(window, expression) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await window.webContents.executeJavaScript(expression)) return
    await pause(40)
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}
const menuButton = (label) => `[...document.querySelectorAll('[role="menubar"] button')].find(button => button.textContent === ${JSON.stringify(label)})`
const menuAction = (label) => `[...document.querySelectorAll('[role="menu"] [data-menu-id]')].find(item => item.textContent.includes(${JSON.stringify(label)}))`

async function testChrome(window) {
  const contents = window.webContents
  await waitFor(window, `Boolean(${menuButton('File')})`)
  assert.equal(window.isMenuBarVisible(), false, 'native menu strip must be hidden')
  const safeArea = await contents.executeJavaScript(`(() => {
    const overlay = navigator.windowControlsOverlay;
    const rect = overlay?.getTitlebarAreaRect();
    const content = document.querySelector('.latch-titlebar-content').getBoundingClientRect();
    return { visible: overlay?.visible, available: rect?.width, right: rect?.right, contentRight: content.right, width: innerWidth };
  })()`)
  assert.equal(safeArea.visible, true, 'native window controls must remain available')
  assert.ok(safeArea.available > 0 && safeArea.available < safeArea.width)
  assert.ok(safeArea.contentRight <= safeArea.right + 1, 'header must not overlap native window controls')

  await contents.executeJavaScript(`${menuButton('File')}.click()`)
  await waitFor(window, `Boolean(${menuAction('Open SQL File')})`)
  await contents.executeJavaScript(`${menuAction('Open SQL File')}.click()`)
  for (let attempt = 0; fileDialogs === 0 && attempt < 100; attempt++) await pause(30)
  assert.equal(fileDialogs, 1, 'rendered File menu must use the existing file-open workflow')

  const oldClipboard = clipboard.readText()
  try {
    await contents.executeJavaScript(`(() => {
      const input = document.createElement('input');
      input.id = 'menu-focus-test'; input.value = 'SELECT * FROM customers';
      document.body.append(input); input.focus(); input.select();
      ${menuButton('Edit')}.click();
    })()`)
    await waitFor(window, `Boolean(${menuAction('Copy')})`)
    await contents.executeJavaScript(`${menuAction('Copy')}.click()`)
    for (let attempt = 0; clipboard.readText() !== 'SELECT * FROM customers' && attempt < 100; attempt++) await pause(30)
    assert.equal(clipboard.readText(), 'SELECT * FROM customers', 'Copy must act on the original focused input')
    await contents.executeJavaScript(`document.getElementById('menu-focus-test').remove()`)
  } finally {
    clipboard.writeText(oldClipboard)
  }

  window.focus()
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'F10' })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'F10' })
  await waitFor(window, `document.activeElement === ${menuButton('File')}`)
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
  await waitFor(window, `document.activeElement === ${menuButton('Edit')}`)
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
  await waitFor(window, `Boolean(${menuAction('Undo')})`)
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await waitFor(window, `!document.querySelector('[role="menu"]')`)
  assert.equal(window.isMenuBarVisible(), false, 'F10 must not reveal the old native menu strip')

  for (const mode of ['dark', 'light']) {
    await contents.executeJavaScript(`document.querySelector('[aria-label="Open settings"]').click()`)
    await waitFor(window, `Boolean(document.querySelector('[role="dialog"] [aria-label="${mode === 'dark' ? 'Dark' : 'Light'}"]'))`)
    await contents.executeJavaScript(`document.querySelector('[role="dialog"] [aria-label="${mode === 'dark' ? 'Dark' : 'Light'}"]').click(); [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Save settings').click()`)
    await waitFor(window, `!document.querySelector('[role="dialog"]')`)
    await contents.executeJavaScript(`${menuButton('File')}.click()`)
    await waitFor(window, `Boolean(${menuAction('Save As')})`)
    await pause(150)
    fs.writeFileSync(path.join(screenshotDirectory, `window-chrome-${mode}.png`), (await window.capturePage()).toPNG())
    await contents.executeJavaScript(`${menuButton('File')}.click()`)
  }
  assert.equal(BrowserWindow.getAllWindows().length, 1)
  console.log('PASS Windows window controls, rendered menus, File actions, Copy focus, F10/arrow/Escape navigation, and dark/light themes.')
}

require(path.resolve('out/main/index.js'))
