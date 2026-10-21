import { contextBridge, ipcRenderer } from 'electron'
import type { LatchApi, MenuCommand } from '../shared/types'

const api: LatchApi = {
  platform: process.platform,
  openSqlFiles: () => ipcRenderer.invoke('files:open-sql'),
  readSqlFile: (path) => ipcRenderer.invoke('files:read-sql', path),
  writeSqlFile: (path, content, encoding) => ipcRenderer.invoke('files:write-sql', path, content, encoding),
  retainFileAccess: (paths) => ipcRenderer.invoke('files:retain-access', paths),
  chooseSqlFilePath: (defaultPath) => ipcRenderer.invoke('files:choose-save-path', defaultPath),
  writeDraftBackup: (tabId, content) => ipcRenderer.invoke('drafts:write', tabId, content),
  writeDraftBackupSync: (tabId, content) => { ipcRenderer.sendSync('drafts:write-sync', tabId, content) },
  readDraftBackup: (tabId) => ipcRenderer.invoke('drafts:read', tabId),
  deleteDraftBackup: (tabId) => ipcRenderer.invoke('drafts:delete', tabId),
  pruneDraftBackups: (keepTabIds) => ipcRenderer.invoke('drafts:prune', keepTabIds),
  onMenuCommand: (callback) => {
    const listener = (_event: unknown, command: MenuCommand): void => callback(command)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
  },
  listProviders: () => ipcRenderer.invoke('providers:list'),
  listConnections: () => ipcRenderer.invoke('connections:list'),
  openDatabase: () => ipcRenderer.invoke('connections:open'),
  createDatabase: () => ipcRenderer.invoke('connections:create'),
  addServerConnection: (input) => ipcRenderer.invoke('connections:add-server', input),
  removeConnection: (id) => ipcRenderer.invoke('connections:remove', id),
  listDatabases: (connectionId) => ipcRenderer.invoke('database:list', connectionId),
  getSchema: (connectionId, database) => ipcRenderer.invoke('database:schema', connectionId, database),
  executeQuery: (connectionId, database, sql) => ipcRenderer.invoke('database:execute', connectionId, database, sql),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  onCloseActiveTab: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('tabs:close-active', listener)
    return () => ipcRenderer.removeListener('tabs:close-active', listener)
  }
}

contextBridge.exposeInMainWorld('latch', api)

