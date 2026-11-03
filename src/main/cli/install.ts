import { app } from 'electron'
import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import type { CliInstallStatus } from '../../shared/types'
import { launcherFileName, launcherScript, type LauncherTarget } from './launcher'

const LAUNCHER_MARKER = 'Installed by Latch.'

function launcherTarget(): LauncherTarget {
  return {
    platform: process.platform,
    // An AppImage runs from a temporary mount; the launcher must start the AppImage file itself.
    executable: process.env.APPIMAGE || process.execPath,
    appPath: app.isPackaged ? undefined : app.getAppPath()
  }
}

function installDirectory(): string {
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Latch', 'bin')
  return join(homedir(), '.local', 'bin')
}

/** Apps started from the Dock or a desktop launcher do not inherit the user's shell PATH, so ask the shell. */
function shellPath(): Promise<string> {
  if (process.platform === 'win32') return Promise.resolve(process.env.Path ?? process.env.PATH ?? '')
  const shell = process.env.SHELL || '/bin/sh'
  return new Promise((resolvePath) => {
    execFile(shell, ['-ilc', 'printf "__LATCH_PATH__%s__LATCH_PATH__" "$PATH"'], { timeout: 4_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } }, (_error, stdout) => {
      const match = String(stdout ?? '').match(/__LATCH_PATH__(.*?)__LATCH_PATH__/s)
      resolvePath(match?.[1] ?? process.env.PATH ?? '')
    })
  })
}

let cachedShellPath: Promise<string> | undefined

async function isOnPath(directory: string): Promise<boolean> {
  cachedShellPath ??= shellPath()
  const normalize = (value: string): string => {
    const resolved = resolve(value.replace(/^~(?=$|[\\/])/, homedir())).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const target = normalize(directory)
  return (await cachedShellPath).split(delimiter).filter(Boolean).some((entry) => normalize(entry) === target)
}

export async function cliInstallStatus(): Promise<CliInstallStatus> {
  const directory = installDirectory()
  const path = join(directory, launcherFileName(process.platform))
  const existing = await readFile(path, 'utf8').catch(() => null)
  return {
    path,
    installed: existing !== null && existing.includes(LAUNCHER_MARKER),
    outdated: existing !== null && existing.includes(LAUNCHER_MARKER) && existing !== launcherScript(launcherTarget()),
    onPath: await isOnPath(directory)
  }
}

export async function installCli(): Promise<CliInstallStatus> {
  const directory = installDirectory()
  const path = join(directory, launcherFileName(process.platform))
  const existing = await readFile(path, 'utf8').catch(() => null)
  if (existing !== null && !existing.includes(LAUNCHER_MARKER)) {
    throw new Error(`${path} already exists and was not installed by Latch. Remove it first.`)
  }
  await mkdir(directory, { recursive: true })
  await writeFile(path, launcherScript(launcherTarget()), { mode: 0o755 })
  if (process.platform !== 'win32') await chmod(path, 0o755)
  return cliInstallStatus()
}
