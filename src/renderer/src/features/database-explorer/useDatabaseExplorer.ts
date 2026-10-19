import { useCallback, useEffect, useRef, useState } from 'react'
import type { Connection, DatabaseObject } from '../../../../shared/types'
import { connectionDatabaseKey } from '../../query-tabs'
import { preferredDatabase } from '../database-catalog/useDatabaseCatalog'
import {
  EXPLORER_STORAGE_KEY,
  readExplorerSnapshot,
  serializeExplorerSnapshot,
  type ExplorerSnapshot
} from './explorer-persistence'

interface UseDatabaseExplorerOptions {
  connections: Connection[]
  databasesByConnection: Record<string, string[]>
  schemasByContext: Record<string, DatabaseObject[]>
  loadDatabases: (
    connection: Exclude<Connection, { provider: 'sqlite' }>,
    force?: boolean
  ) => Promise<string[]>
  loadSchema: (connectionId: string, database?: string, force?: boolean) => Promise<DatabaseObject[]>
}

export function useDatabaseExplorer({
  connections,
  databasesByConnection,
  schemasByContext,
  loadDatabases,
  loadSchema
}: UseDatabaseExplorerOptions) {
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [database, setDatabase] = useState<string | undefined>()
  const initializedRef = useRef(false)
  const connectionIdRef = useRef(connectionId)
  connectionIdRef.current = connectionId

  const connection = connections.find((candidate) => candidate.id === connectionId) ?? null
  const databases = connection ? databasesByConnection[connection.id] ?? [] : []
  const schema = connection
    ? schemasByContext[connectionDatabaseKey(connection.id, database)] ?? []
    : []

  const initialize = useCallback((availableConnections: Connection[], fallback: ExplorerSnapshot): void => {
    if (initializedRef.current) return
    initializedRef.current = true
    const saved = readExplorerSnapshot(localStorage.getItem(EXPLORER_STORAGE_KEY))
    const savedConnection = saved?.connectionId
      ? availableConnections.find((candidate) => candidate.id === saved.connectionId)
      : undefined
    const selectedConnection = savedConnection
      ?? availableConnections.find((candidate) => candidate.id === fallback.connectionId)
      ?? availableConnections[0]
    setConnectionId(selectedConnection?.id ?? null)
    setDatabase(selectedConnection?.provider === 'sqlite'
      ? undefined
      : savedConnection ? saved?.database : fallback.database)
  }, [])

  useEffect(() => {
    if (!initializedRef.current) return
    localStorage.setItem(EXPLORER_STORAGE_KEY, serializeExplorerSnapshot({ connectionId, database }))
  }, [connectionId, database])

  useEffect(() => {
    if (!connection) {
      setDatabase(undefined)
      return
    }
    if (connection.provider === 'sqlite') {
      setDatabase(undefined)
      return
    }

    const cached = databasesByConnection[connection.id]
    if (cached) {
      setDatabase((current) => current && cached.includes(current)
        ? current
        : preferredDatabase(connection, cached))
    }
    void loadDatabases(connection).then((items) => {
      if (connectionIdRef.current !== connection.id) return
      setDatabase((current) => current && items.includes(current)
        ? current
        : preferredDatabase(connection, items))
    }).catch(console.error)
  }, [connection, databasesByConnection, loadDatabases])

  useEffect(() => {
    if (!connection || (connection.provider !== 'sqlite' && !database)) return
    void loadSchema(connection.id, database).catch(console.error)
  }, [connection, database, loadSchema])

  const selectConnection = useCallback((nextConnectionId: string): void => {
    setConnectionId(nextConnectionId)
    setDatabase(undefined)
  }, [])

  const selectDatabase = useCallback((nextConnectionId: string, nextDatabase: string): void => {
    setConnectionId(nextConnectionId)
    setDatabase(nextDatabase)
  }, [])

  const refreshDatabases = useCallback((): void => {
    if (!connection || connection.provider === 'sqlite') return
    void loadDatabases(connection, true).then((items) => {
      if (connectionIdRef.current !== connection.id) return
      setDatabase((current) => current && items.includes(current)
        ? current
        : preferredDatabase(connection, items))
    }).catch(console.error)
  }, [connection, loadDatabases])

  const refreshSchema = useCallback((): void => {
    if (!connection || (connection.provider !== 'sqlite' && !database)) return
    void loadSchema(connection.id, database, true).catch(console.error)
  }, [connection, database, loadSchema])

  const selectAddedConnection = useCallback((nextConnectionId: string): void => {
    setConnectionId(nextConnectionId)
    setDatabase(undefined)
  }, [])

  const handleConnectionRemoved = useCallback((removedConnectionId: string, remaining: Connection[]): void => {
    if (connectionIdRef.current !== removedConnectionId) return
    setConnectionId(remaining[0]?.id ?? null)
    setDatabase(undefined)
  }, [])

  return {
    connectionId,
    database,
    connection,
    databases,
    schema,
    initialize,
    selectConnection,
    selectDatabase,
    selectAddedConnection,
    handleConnectionRemoved,
    refreshDatabases,
    refreshSchema
  }
}
