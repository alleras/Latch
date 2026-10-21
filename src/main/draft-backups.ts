import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** Directory name under the application data directory that holds unsaved-edit backups. */
export const DRAFT_BACKUP_DIRECTORY = 'drafts'

const DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BACKUP_NAME_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.sql$/i
const TEMPORARY_NAME_PATTERN = /\.(\d+)\.\d+\.tmp$/
/** Backups no restored tab claims are kept this long before pruning, in case another Latch process owns them. */
const ORPHANED_BACKUP_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Another process's temporary files are kept this long before pruning, in case it is still writing them. */
const ABANDONED_TEMPORARY_AGE_MS = 60 * 60 * 1000
/** Waits between attempts to read a backup that is briefly locked, for example by a virus scanner. */
const READ_RETRY_DELAYS_MS = [100, 300, 900]
const TRANSIENT_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN'])

const inFlightWrites = new Set<Promise<void>>()
/**
 * The newest write issued for each tab. A write lands only while it is still the newest, and a delete
 * clears the entry, so a slow write can neither replace newer text nor bring back a deleted backup.
 */
const latestWrites = new Map<string, number>()
let writeCounter = 0
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

function issueWrite(tabId: string): number {
  writeCounter += 1
  latestWrites.set(tabId, writeCounter)
  return writeCounter
}

/** Renames the finished temporary file over the backup if this write is still the newest for the tab. */
function landWrite(tabId: string, write: number, temporary: string, path: string): boolean {
  if (latestWrites.get(tabId) !== write) return false
  renameSync(temporary, path)
  latestWrites.delete(tabId)
  return true
}

/**
 * Writes atomically: the content lands in a temporary file that is then renamed over the backup,
 * so a reader (or a crash) never sees a half-written backup.
 */
export function writeDraftBackup(directory: string, tabId: string, content: string): Promise<void> {
  const path = draftBackupPath(directory, tabId)
  const temporary = temporaryPath(path)
  const ticket = issueWrite(tabId)
  const write = (async (): Promise<void> => {
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(temporary, content, 'utf8')
      // Checking and renaming happen in one synchronous step, so no newer write or delete slips between them.
      if (!landWrite(tabId, ticket, temporary, path)) await rm(temporary, { force: true })
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
  const ticket = issueWrite(tabId)
  mkdirSync(directory, { recursive: true })
  try {
    writeFileSync(temporary, content, 'utf8')
    landWrite(tabId, ticket, temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/** Resolves once every backup write started so far has finished; awaited before the app quits. */
export function flushDraftBackups(): Promise<void> {
  return Promise.allSettled([...inFlightWrites]).then(() => undefined)
}

/**
 * Null only when there is no backup. A backup that exists but cannot be read is retried briefly
 * and then rejects, so the caller never mistakes a locked backup for a missing one.
 */
export async function readDraftBackup(
  directory: string,
  tabId: string,
  retryDelays: readonly number[] = READ_RETRY_DELAYS_MS
): Promise<string | null> {
  const path = draftBackupPath(directory, tabId)
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return null
      if (attempt >= retryDelays.length || !TRANSIENT_ERROR_CODES.has(errorCode(error) ?? '')) throw error
      await delay(retryDelays[attempt])
    }
  }
}

export async function deleteDraftBackup(directory: string, tabId: string): Promise<void> {
  const path = draftBackupPath(directory, tabId)
  // Synchronous, so a write issued after this delete cannot have its backup removed by it.
  latestWrites.delete(tabId)
  rmSync(path, { force: true })
}

/**
 * Removes leftovers at launch: temporary files another process abandoned mid-write, and backups that
 * no restored tab claims. Both must have sat untouched for a while, in case another Latch process
 * still owns them.
 */
export async function pruneDraftBackups(directory: string, keepIds: string[], now = Date.now()): Promise<void> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if (isMissingFile(error)) return
    throw error
  }
  const keep = new Set(keepIds.map((id) => id.toLowerCase()))
  await Promise.all(names.map(async (name) => {
    const temporaryOwner = TEMPORARY_NAME_PATTERN.exec(name)?.[1]
    const backupId = BACKUP_NAME_PATTERN.exec(name)?.[1]?.toLowerCase()
    let maximumAge: number
    if (temporaryOwner !== undefined) {
      if (Number(temporaryOwner) === process.pid) return
      maximumAge = ABANDONED_TEMPORARY_AGE_MS
    } else if (backupId !== undefined) {
      if (keep.has(backupId) || latestWrites.has(backupId)) return
      maximumAge = ORPHANED_BACKUP_AGE_MS
    } else {
      return
    }
    const path = join(directory, name)
    try {
      if (now - (await stat(path)).mtimeMs > maximumAge) await rm(path, { force: true })
    } catch (error) {
      console.error('Failed to prune an unsaved-edit backup.', error)
    }
  }))
}

function errorCode(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : undefined
}

function isMissingFile(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}
