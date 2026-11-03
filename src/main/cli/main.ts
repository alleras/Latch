import { app } from 'electron'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadStoredConnections } from '../connections'
import {
  closeAllProviderConnections,
  executeProviderBoundedQuery,
  getProviderSchema,
  listProviderDatabases,
  providerDefinition,
  providerDialect
} from '../providers'
import { EXIT_CODES } from './spec'
import { runProgram, type CliServices } from './program'

const services: CliServices = {
  version: app.getVersion(),
  loadConnections: loadStoredConnections,
  provider: (connection) => ({ definition: providerDefinition(connection), dialect: providerDialect(connection) }),
  listDatabases: listProviderDatabases,
  getSchema: getProviderSchema,
  executeBounded: executeProviderBoundedQuery,
  readFile: (path) => readFile(path, 'utf8'),
  readStdin: async () => {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    return Buffer.concat(chunks).toString('utf8')
  },
  fileExists: existsSync
}

function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  if (!text) return Promise.resolve()
  return new Promise((resolve) => stream.write(text, () => resolve()))
}

/**
 * Runs one `latch` command without a window. The process is the Latch app itself, so it can decrypt
 * saved passwords; it never writes the connection store, and exits when the command finishes.
 */
export function runCli(argv: string[]): void {
  // Keep Chromium's own storage away from the running app's profile, and allow parallel commands.
  const sessionDirectory = mkdtempSync(join(tmpdir(), 'latch-cli-'))
  app.setPath('sessionData', sessionDirectory)
  app.disableHardwareAcceleration()
  if (process.platform === 'darwin') app.setActivationPolicy('prohibited')

  const finish = async (exitCode: number): Promise<void> => {
    await closeAllProviderConnections().catch(() => undefined)
    rmSync(sessionDirectory, { recursive: true, force: true })
    app.exit(exitCode)
  }

  void app.whenReady()
    .then(() => runProgram(argv, services, { stdoutIsTTY: Boolean(process.stdout.isTTY) }))
    .then(async (result) => {
      await write(process.stdout, result.stdout)
      await write(process.stderr, result.stderr)
      await finish(result.exitCode)
    })
    .catch(async (error: unknown) => {
      await write(process.stderr, `latch: ${error instanceof Error ? error.message : String(error)}\n`)
      await finish(EXIT_CODES.error)
    })
}
