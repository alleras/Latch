import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLI_FLAG, cliArguments, launcherFileName, launcherScript } from '../src/main/cli/launcher.ts'

test('command line arguments are everything after the flag, without the separator for Chromium', () => {
  assert.equal(cliArguments(['/Applications/Latch.app/Contents/MacOS/Latch']), null)
  assert.deepEqual(cliArguments(['Latch', CLI_FLAG, '--', 'query', '--write']), ['query', '--write'])
  assert.deepEqual(cliArguments(['electron', '/repo', CLI_FLAG]), [])
})

test('the POSIX launcher quotes paths and passes arguments through untouched', () => {
  const script = launcherScript({ platform: 'darwin', executable: "/Applications/Bob's Latch.app/Contents/MacOS/Latch" })
  assert.equal(launcherFileName('darwin'), 'latch')
  assert.match(script, /^#!\/bin\/sh\n/)
  assert.match(script, /unset ELECTRON_RUN_AS_NODE/)
  assert.match(script, /exec '\/Applications\/Bob'\\''s Latch\.app\/Contents\/MacOS\/Latch' --latch-cli -- "\$@"/)
})

test('a development launcher also passes the app directory to Electron', () => {
  const script = launcherScript({ platform: 'linux', executable: '/repo/node_modules/electron/dist/electron', appPath: '/repo' })
  assert.match(script, /exec '\/repo\/node_modules\/electron\/dist\/electron' '\/repo' --latch-cli -- "\$@"/)
})

test('the Windows launcher is a batch file that forwards the exit code', () => {
  const script = launcherScript({ platform: 'win32', executable: 'C:\\Users\\me\\AppData\\Local\\Programs\\latch\\Latch.exe' })
  assert.equal(launcherFileName('win32'), 'latch.cmd')
  assert.match(script, /"C:\\Users\\me\\AppData\\Local\\Programs\\latch\\Latch\.exe" --latch-cli -- %\*\r\n/)
  assert.match(script, /exit \/b %ERRORLEVEL%/)
  assert.match(launcherScript({ platform: 'win32', executable: 'C:\\100%\\Latch.exe' }), /C:\\100%%\\Latch\.exe/)
})
