import { app, clipboard, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ServerConnectionInput } from '../shared/types'
import {
  addSqliteConnection,
  buildServerConnection,
  findConnection,
  listConnections,
  persistConnection,
  removeConnection,
  toPublicConnection
} from './connections'
import {
  DRAFT_BACKUP_DIRECTORY,
  deleteDraftBackup,
  pruneDraftBackups,
  readDraftBackup,
  writeDraftBackup,
  writeDraftBackupSync
} from './draft-backups'
import { createFileAccess } from './file-access'
import { closeProviderConnection, executeProviderQuery, getProviderSchema, listProviderDatabases, providers, testProviderConnection } from './providers'
import { isSqlFileEncoding, readSqlFile, writeSqlFile } from './sql-files'

/** File under the application data directory listing the files the user picked in a dialog. */
const FILE_ACCESS_STORE = 'file-access.json'

const SQL_FILE_FILTERS = [
  { name: 'SQL files', extensions: ['sql'] },
  { name: 'All files', extensions: ['*'] }
]

function requireText(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  return value
}

function requireTextList(value: unknown, message: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(message)
  return value
}

function registerFileIpc(): void {
  const draftDirectory = (): string => join(app.getPath('userData'), DRAFT_BACKUP_DIRECTORY)
  // The renderer reads and writes files by path only after the user picked them in one of these dialogs.
  const fileAccess = createFileAccess(join(app.getPath('userData'), FILE_ACCESS_STORE))

  ipcMain.handle('files:open-sql', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open SQL file',
      properties: ['openFile', 'multiSelections'],
      filters: SQL_FILE_FILTERS
    })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map((path) => readSqlFile(fileAccess.grant(path))))
  })

  ipcMain.handle('files:read-sql', (_event, path: unknown) => readSqlFile(fileAccess.check(requireText(path, 'File path must be text.'))))

  ipcMain.handle('files:write-sql', (_event, path: unknown, content: unknown, encoding: unknown) => {
    if (!isSqlFileEncoding(encoding)) throw new Error('Unknown file encoding.')
    return writeSqlFile(
      fileAccess.check(requireText(path, 'File path must be text.')),
      requireText(content, 'File content must be text.'),
      encoding
    )
  })

  ipcMain.handle('files:retain-access', (_event, paths: unknown) => fileAccess.retain(requireTextList(paths, 'File paths must be text.')))

  ipcMain.handle('files:choose-save-path', async (_event, defaultPath: unknown) => {
    const result = await dialog.showSaveDialog({
      title: 'Save SQL file',
      defaultPath: requireText(defaultPath, 'Default path must be text.'),
      filters: [SQL_FILE_FILTERS[0]]
    })
    return result.canceled || !result.filePath ? null : fileAccess.grant(result.filePath)
  })

  ipcMain.handle('drafts:write', (_event, tabId: unknown, content: unknown) => writeDraftBackup(
    draftDirectory(),
    requireText(tabId, 'Draft id must be text.'),
    requireText(content, 'Draft content must be text.')
  ))

  ipcMain.on('drafts:write-sync', (event, tabId: unknown, content: unknown) => {
    try {
      writeDraftBackupSync(draftDirectory(), requireText(tabId, 'Draft id must be text.'), requireText(content, 'Draft content must be text.'))
      event.returnValue = true
    } catch (error) {
      console.error('Failed to write draft backup.', error)
      event.returnValue = false
    }
  })

  ipcMain.handle('drafts:read', (_event, tabId: unknown) => readDraftBackup(draftDirectory(), requireText(tabId, 'Draft id must be text.')))
  ipcMain.handle('drafts:delete', (_event, tabId: unknown) => deleteDraftBackup(draftDirectory(), requireText(tabId, 'Draft id must be text.')))
  ipcMain.handle('drafts:prune', (_event, keepTabIds: unknown) => pruneDraftBackups(
    draftDirectory(),
    requireTextList(keepTabIds, 'Draft ids must be text.')
  ))
}

export function registerIpc(): void {
  ipcMain.handle('providers:list', () => providers)
  ipcMain.handle('connections:list', () => listConnections())
  ipcMain.handle('clipboard:write', (_event, text: unknown) => {
    if (typeof text !== 'string') throw new Error('Clipboard content must be text.')
    clipboard.writeText(text)
  })
  registerFileIpc()

  ipcMain.handle('connections:open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open SQLite database',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : addSqliteConnection(result.filePaths[0])
  })

  ipcMain.handle('connections:create', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Create SQLite database',
      defaultPath: 'untitled.db',
      filters: [{ name: 'SQLite database', extensions: ['db'] }]
    })
    if (result.canceled || !result.filePath) return null
    new DatabaseSync(result.filePath).close()
    return addSqliteConnection(result.filePath)
  })

  ipcMain.handle('connections:add-server', async (_event, input: ServerConnectionInput) => {
    if (!providers.some((provider) => provider.id === input.provider && provider.mode === 'server')) throw new Error('Unsupported database provider.')
    const connection = buildServerConnection(input)
    await testProviderConnection(connection)
    persistConnection(connection)
    return toPublicConnection(connection)
  })

  ipcMain.handle('connections:remove', async (_event, id: string) => {
    const connection = findConnection(id)
    const remainingConnections = removeConnection(id)
    await closeProviderConnection(connection).catch((error: unknown) => {
      console.error(`Failed to close database sessions for ${connection.name}.`, error)
    })
    return remainingConnections
  })

  ipcMain.handle('database:list', async (_event, connectionId: string) => {
    const connection = findConnection(connectionId)
    return listProviderDatabases(connection)
  })

  ipcMain.handle('database:schema', async (_event, connectionId: string, database?: string) => {
    const connection = findConnection(connectionId)
    return getProviderSchema(connection, database)
  })

  ipcMain.handle('database:execute', async (_event, connectionId: string, database: string | undefined, query: string, sessionId: string) => {
    if (!query.trim()) throw new Error('Write a query first.')
    if (!sessionId) throw new Error('The query session is unavailable.')
    const connection = findConnection(connectionId)
    return executeProviderQuery(connection, database, query, sessionId)
  })
}
