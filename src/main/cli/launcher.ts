/**
 * The `latch` command is a small script that starts the Latch executable in command line mode. Latch
 * has to run as itself: saved passwords are encrypted with the operating system's credential store
 * for the Latch app, so no other process can read them.
 */

/** Marks a command line launch. Everything after it belongs to the `latch` command. */
export const CLI_FLAG = '--latch-cli'

export interface LauncherTarget {
  platform: NodeJS.Platform
  /** The Latch (or, in development, Electron) executable. */
  executable: string
  /** The app directory, needed only when running from source with a separate Electron binary. */
  appPath?: string
}

/** Returns the `latch` arguments when this process was started by the launcher, otherwise null. */
export function cliArguments(argv: string[]): string[] | null {
  const index = argv.indexOf(CLI_FLAG)
  if (index === -1) return null
  const rest = argv.slice(index + 1)
  // The launcher passes `--` so Chromium leaves the user's arguments alone; it is not part of them.
  if (rest[0] === '--') rest.shift()
  return rest
}

export function launcherFileName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'latch.cmd' : 'latch'
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function batchQuote(value: string): string {
  if (value.includes('"')) throw new Error('The Latch install path cannot contain double quotes.')
  return `"${value.replaceAll('%', '%%')}"`
}

export function launcherScript({ platform, executable, appPath }: LauncherTarget): string {
  if (platform === 'win32') {
    const command = [batchQuote(executable), ...(appPath ? [batchQuote(appPath)] : []), CLI_FLAG, '--', '%*'].join(' ')
    return [
      '@echo off',
      'rem Installed by Latch. Runs the Latch command line with the connections saved in the app.',
      'setlocal',
      'set ELECTRON_RUN_AS_NODE=',
      command,
      'exit /b %ERRORLEVEL%',
      ''
    ].join('\r\n')
  }
  const command = ['exec', shellQuote(executable), ...(appPath ? [shellQuote(appPath)] : []), CLI_FLAG, '--', '"$@"'].join(' ')
  return [
    '#!/bin/sh',
    '# Installed by Latch. Runs the Latch command line with the connections saved in the app.',
    'unset ELECTRON_RUN_AS_NODE',
    command,
    ''
  ].join('\n')
}
