import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Connection, ServerConnectionInput } from '../shared/types'
import type { StoredConnection, StoredServerConnection } from './types'

function storePath(): string {
  return join(app.getPath('userData'), 'connections.json')
}

export function loadStoredConnections(): StoredConnection[] {
  if (!existsSync(storePath())) return []
  try {
    return JSON.parse(readFileSync(storePath(), 'utf8')) as StoredConnection[]
  } catch {
    return []
  }
}

function save(connections: StoredConnection[]): void {
  writeFileSync(storePath(), JSON.stringify(connections, null, 2))
}

export function toPublicConnection(connection: StoredConnection): Connection {
  if (connection.provider === 'sqlite') return connection
  const { encryptedPassword: _, ...publicConnection } = connection
  return publicConnection
}

export function listConnections(): Connection[] {
  return loadStoredConnections().map(toPublicConnection)
}

export function addSqliteConnection(path: string): Connection {
  const existing = loadStoredConnections().find((connection) => connection.provider === 'sqlite' && connection.path === path)
  if (existing) return existing

  const connection = { id: randomUUID(), name: basename(path), provider: 'sqlite' as const, path }
  save([...loadStoredConnections(), connection])
  return connection
}

export function buildServerConnection(input: ServerConnectionInput): StoredServerConnection {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is not available on this system.')
  if (!input.host?.trim() || !input.username?.trim() || !input.password) throw new Error('Host, username, and password are required.')
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) throw new Error('Enter a valid TCP port.')

  return {
    id: randomUUID(),
    provider: input.provider,
    name: input.name.trim() || input.host.trim(),
    host: input.host.trim(),
    port: input.port,
    username: input.username.trim(),
    initialDatabase: input.initialDatabase?.trim() || undefined,
    ssl: input.ssl,
    trustServerCertificate: input.trustServerCertificate,
    encryptedPassword: safeStorage.encryptString(input.password).toString('base64')
  }
}

export function persistConnection(connection: StoredConnection): void {
  save([...loadStoredConnections(), connection])
}

export function removeConnection(id: string): Connection[] {
  const connections = loadStoredConnections().filter((connection) => connection.id !== id)
  save(connections)
  return connections.map(toPublicConnection)
}

export function findConnection(id: string): StoredConnection {
  const connection = loadStoredConnections().find((item) => item.id === id)
  if (!connection) throw new Error('That connection no longer exists.')
  return connection
}

