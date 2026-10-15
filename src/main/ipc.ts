import { clipboard, dialog, ipcMain } from 'electron'
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
import { closeProviderConnection, executeProviderQuery, getProviderSchema, listProviderDatabases, providers, testProviderConnection } from './providers'

export function registerIpc(): void {
  ipcMain.handle('providers:list', () => providers)
  ipcMain.handle('connections:list', () => listConnections())
  ipcMain.handle('clipboard:write', (_event, text: unknown) => {
    if (typeof text !== 'string') throw new Error('Clipboard content must be text.')
    clipboard.writeText(text)
  })

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

  ipcMain.handle('database:execute', async (_event, connectionId: string, database: string | undefined, query: string) => {
    if (!query.trim()) throw new Error('Write a query first.')
    const connection = findConnection(connectionId)
    return executeProviderQuery(connection, database, query)
  })
}
