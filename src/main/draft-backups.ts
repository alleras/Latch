import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Directory name under the application data directory that holds unsaved-edit backups. */
export const DRAFT_BACKUP_DIRECTORY = 'drafts'

const DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const inFlightWrites = new Set<Promise<void>>()
let temporaryCounter = 0

export function draftBackupPath(directory: string, tabId: string): string {
  if (!DRAFT_ID_PATTERN.test(tabId)) throw new Error('Invalid draft id.')
  return join(directory, `${tabId}.sql`)
}

/** Each write gets its own temporary file, so concurrent writers for one tab never share a buffer. */
function temporaryPath(path: string): string {
  temporaryCounter += 1
  return `${path}.${process.pid}.${temporaryCounter}.tmp`
}

/**
 * Writes atomically: the content lands in a temporary file that is then renamed over the backup,
 * so a reader (or a crash) never sees a half-written backup.
 */
export function writeDraftBackup(directory: string, tabId: string, content: string): Promise<void> {
  const path = draftBackupPath(directory, tabId)
  const temporary = temporaryPath(path)
  const write = (async (): Promise<void> => {
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(temporary, content, 'utf8')
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  })()
  inFlightWrites.add(write)
  return write.finally(() => inFlightWrites.delete(write))
}

export function writeDraftBackupSync(directory: string, tabId: string, content: string): void {
  const path = draftBackupPath(directory, tabId)
  const temporary = temporaryPath(path)
  mkdirSync(directory, { recursive: true })
  try {
    writeFileSync(temporary, content, 'utf8')
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/** Resolves once every backup write started so far has finished; awaited before the app quits. */
export function flushDraftBackups(): Promise<void> {
  return Promise.allSettled([...inFlightWrites]).then(() => undefined)
}

export async function readDraftBackup(directory: string, tabId: string): Promise<string | null> {
  try {
    return await readFile(draftBackupPath(directory, tabId), 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

export async function deleteDraftBackup(directory: string, tabId: string): Promise<void> {
  await rm(draftBackupPath(directory, tabId), { force: true })
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}
