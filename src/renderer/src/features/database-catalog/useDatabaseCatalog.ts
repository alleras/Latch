import { useCallback, useRef, useState } from 'react'
import type { Connection, DatabaseObject } from '../../../../shared/types'
import { connectionDatabaseKey } from '../../query-tabs'

interface DatabaseCatalogState {
  databasesByConnection: Record<string, string[]>
  schemasByContext: Record<string, DatabaseObject[]>
  loadingDatabaseIds: Set<string>
  loadingSchemaKeys: Set<string>
}

export function preferredDatabase(connection: Connection, databases: string[]): string | undefined {
  if (connection.provider === 'sqlite') return undefined
  if (connection.initialDatabase && databases.includes(connection.initialDatabase)) return connection.initialDatabase
  return databases.find((name) => !['master', 'postgres', 'mysql', 'information_schema'].includes(name)) ?? databases[0]
}

export function useDatabaseCatalog() {
  const [state, setState] = useState<DatabaseCatalogState>({
    databasesByConnection: {},
    schemasByContext: {},
    loadingDatabaseIds: new Set(),
    loadingSchemaKeys: new Set()
  })
  const databaseCacheRef = useRef(new Map<string, string[]>())
  const databaseRequestsRef = useRef(new Map<string, Promise<string[]>>())
  const schemaCacheRef = useRef(new Map<string, DatabaseObject[]>())
  const schemaRequestsRef = useRef(new Map<string, Promise<DatabaseObject[]>>())

  const loadDatabases = useCallback(async (
    connection: Exclude<Connection, { provider: 'sqlite' }>,
    force = false
  ): Promise<string[]> => {
    const cached = databaseCacheRef.current.get(connection.id)
    if (cached && !force) return cached

    const pending = databaseRequestsRef.current.get(connection.id)
    if (pending) return pending

    setState((current) => ({
      ...current,
      loadingDatabaseIds: new Set(current.loadingDatabaseIds).add(connection.id)
    }))
    const request = window.latch.listDatabases(connection.id)
    databaseRequestsRef.current.set(connection.id, request)

    try {
      const databases = await request
      databaseCacheRef.current.set(connection.id, databases)
      setState((current) => ({
        ...current,
        databasesByConnection: { ...current.databasesByConnection, [connection.id]: databases }
      }))
      return databases
    } finally {
      databaseRequestsRef.current.delete(connection.id)
      setState((current) => {
        const loadingDatabaseIds = new Set(current.loadingDatabaseIds)
        loadingDatabaseIds.delete(connection.id)
        return { ...current, loadingDatabaseIds }
      })
    }
  }, [])

  const loadSchema = useCallback(async (
    connectionId: string,
    database?: string,
    force = false
  ): Promise<DatabaseObject[]> => {
    const key = connectionDatabaseKey(connectionId, database)
    if (schemaCacheRef.current.has(key) && !force) return schemaCacheRef.current.get(key) ?? []

    const pending = schemaRequestsRef.current.get(key)
    if (pending) {
      if (!force) return pending
      try {
        await pending
      } catch {
        // A forced refresh gets one fresh attempt even if the in-flight load failed.
      }
      const newerPending = schemaRequestsRef.current.get(key)
      if (newerPending) return newerPending
    }

    setState((current) => ({
      ...current,
      loadingSchemaKeys: new Set(current.loadingSchemaKeys).add(key)
    }))
    const request = window.latch.getSchema(connectionId, database)
    schemaRequestsRef.current.set(key, request)

    try {
      const schema = await request
      schemaCacheRef.current.set(key, schema)
      setState((current) => ({
        ...current,
        schemasByContext: { ...current.schemasByContext, [key]: schema }
      }))
      return schema
    } finally {
      schemaRequestsRef.current.delete(key)
      setState((current) => {
        const loadingSchemaKeys = new Set(current.loadingSchemaKeys)
        loadingSchemaKeys.delete(key)
        return { ...current, loadingSchemaKeys }
      })
    }
  }, [])

  const evictConnection = useCallback((connectionId: string): void => {
    databaseCacheRef.current.delete(connectionId)
    databaseRequestsRef.current.delete(connectionId)
    for (const key of schemaCacheRef.current.keys()) {
      if ((JSON.parse(key) as [string, string])[0] === connectionId) schemaCacheRef.current.delete(key)
    }
    for (const key of schemaRequestsRef.current.keys()) {
      if ((JSON.parse(key) as [string, string])[0] === connectionId) schemaRequestsRef.current.delete(key)
    }
    setState((current) => {
      const databasesByConnection = { ...current.databasesByConnection }
      delete databasesByConnection[connectionId]
      return {
        ...current,
        databasesByConnection,
        schemasByContext: Object.fromEntries(
          Object.entries(current.schemasByContext).filter(([key]) => (JSON.parse(key) as [string, string])[0] !== connectionId)
        )
      }
    })
  }, [])

  return {
    ...state,
    loadDatabases,
    loadSchema,
    evictConnection
  }
}
