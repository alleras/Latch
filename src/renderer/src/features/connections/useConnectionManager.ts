import { useCallback, useEffect, useState } from 'react'
import type { Connection, ProviderDefinition, ServerConnectionInput } from '../../../../shared/types'

interface ConnectionState {
  providers: ProviderDefinition[]
  connections: Connection[]
  ready: boolean
}

export function useConnectionManager() {
  const [state, setState] = useState<ConnectionState>({ providers: [], connections: [], ready: false })

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.latch.listProviders(), window.latch.listConnections()]).then(([providers, connections]) => {
      if (!cancelled) setState({ providers, connections, ready: true })
    })
    return () => { cancelled = true }
  }, [])

  const refresh = useCallback(async (): Promise<Connection[]> => {
    const connections = await window.latch.listConnections()
    setState((current) => ({ ...current, connections }))
    return connections
  }, [])

  const openSqlite = useCallback(async (mode: 'open' | 'create'): Promise<Connection | null> => {
    const connection = mode === 'open'
      ? await window.latch.openDatabase()
      : await window.latch.createDatabase()
    if (connection) await refresh()
    return connection
  }, [refresh])

  const addServer = useCallback(async (input: ServerConnectionInput): Promise<Connection> => {
    const connection = await window.latch.addServerConnection(input)
    await refresh()
    return connection
  }, [refresh])

  const remove = useCallback(async (connectionId: string): Promise<Connection[]> => {
    const connections = await window.latch.removeConnection(connectionId)
    setState((current) => ({ ...current, connections }))
    return connections
  }, [])

  return { ...state, openSqlite, addServer, remove }
}
