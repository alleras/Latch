import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Directory name under the application data directory that holds unsaved-edit backups. */
export const DRAFT_BACKUP_DIRECTORY = 'drafts'

const DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function draftBackupPath(directory: string, tabId: string): string {
  if (!DRAFT_ID_PATTERN.test(tabId)) throw new Error('Invalid draft id.')
  return join(directory, `${tabId}.sql`)
}

export async function writeDraftBackup(directory: string, tabId: string, content: string): Promise<void> {
  const path = draftBackupPath(directory, tabId)
  await mkdir(directory, { recursive: true })
  await writeFile(path, content, 'utf8')
}

export function writeDraftBackupSync(directory: string, tabId: string, content: string): void {
  const path = draftBackupPath(directory, tabId)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path, content, 'utf8')
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
