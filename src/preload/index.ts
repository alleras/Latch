import { contextBridge, ipcRenderer } from 'electron'
import type { LatchApi } from '../shared/types'

const api: LatchApi = {
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

