import { useCallback, useEffect, useRef, useState } from 'react'
import type { Connection } from '../../../../shared/types'
import { mayChangeSchema } from '../../../../shared/sql'
import { readableErrorMessage } from '../../errors'
import {
  tabIdsForCloseScope,
  updateQueryTab,
  type CloseTabScope,
  type QueryTabState
} from '../../query-tabs'
import {
  createQueryWorkspaceSnapshot,
  LEGACY_QUERY_STORAGE_KEY,
  QUERY_WORKSPACE_STORAGE_KEY,
  readQueryWorkspace,
  restoreQueryWorkspace
} from '../../query-workspace'

const STARTER_QUERY = `-- Welcome to Latch
-- Write SQL here, then press ⌘↵ to run.

SELECT 1 AS ready;`
const PERSIST_DELAY_MS = 500

export interface RestoredExplorerContext {
  connectionId: string | null
  database?: string
}

interface UseQueryWorkspaceOptions {
  onSchemaChanged: (connectionId: string, database?: string) => void
}

export function useQueryWorkspace({ onSchemaChanged }: UseQueryWorkspaceOptions) {
  const [tabs, setTabs] = useState<QueryTabState[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const draftsRef = useRef(new Map<string, string>())
  const queryNumberRef = useRef(1)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)
  const onSchemaChangedRef = useRef(onSchemaChanged)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId
  onSchemaChangedRef.current = onSchemaChanged

  const persist = useCallback((): void => {
    if (!initializedRef.current) return
    const snapshot = createQueryWorkspaceSnapshot(tabsRef.current, draftsRef.current, activeTabIdRef.current)
    try {
      localStorage.setItem(QUERY_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot))
      localStorage.removeItem(LEGACY_QUERY_STORAGE_KEY)
    } catch (error) {
      // Quota or storage failures must not throw out of a timer; the previous snapshot stays.
      console.error('Failed to persist the query workspace.', error)
    }
  }, [])

  const schedulePersist = useCallback((): void => {
    if (!initializedRef.current) return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persist()
      persistTimerRef.current = null
    }, PERSIST_DELAY_MS)
  }, [persist])

  const initialize = useCallback((connections: Connection[]): RestoredExplorerContext => {
    if (initializedRef.current) {
      const active = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
      return { connectionId: active?.connectionId ?? connections[0]?.id ?? null, database: active?.database }
    }

    const restored = restoreQueryWorkspace(
      readQueryWorkspace(localStorage.getItem(QUERY_WORKSPACE_STORAGE_KEY)),
      new Set(connections.map((connection) => connection.id))
    )
    const fallbackConnection = connections.find((connection) => connection.id === restored.explorerConnectionId)
      ?? connections.find((connection) => connection.id === restored.tabs.find((tab) => tab.id === restored.activeTabId)?.connectionId)
      ?? connections[0]
    let restoredTabs = restored.tabs
    let restoredActiveTabId = restored.activeTabId

    if (restoredTabs.length === 0 && fallbackConnection) {
      const id = crypto.randomUUID()
      restoredTabs = [{
        id,
        title: 'Query 1',
        connectionId: fallbackConnection.id,
        database: fallbackConnection.provider === 'sqlite' ? undefined : fallbackConnection.initialDatabase,
        unsaved: false,
        loading: false,
        result: null,
        error: null,
        running: false
      }]
      restoredActiveTabId = id
      restored.drafts.set(id, localStorage.getItem(LEGACY_QUERY_STORAGE_KEY) ?? STARTER_QUERY)
    }

    draftsRef.current = restored.drafts
    queryNumberRef.current = Math.max(restored.nextQueryNumber, restoredTabs.length > 0 ? 2 : 1)
    tabsRef.current = restoredTabs
    activeTabIdRef.current = restoredActiveTabId
    initializedRef.current = true
    setTabs(restoredTabs)
    setActiveTabId(restoredActiveTabId)

    const connectionId = fallbackConnection?.id ?? null
    const database = fallbackConnection?.id === restored.explorerConnectionId
      ? restored.explorerDatabase
      : restoredTabs.find((tab) => tab.id === restoredActiveTabId && tab.connectionId === connectionId)?.database
    return { connectionId, database }
  }, [])

  useEffect(() => {
    if (initializedRef.current) schedulePersist()
  }, [activeTabId, schedulePersist, tabs])

  useEffect(() => {
    const flush = (): void => persist()
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      persist()
    }
  }, [persist])

  const openQuery = useCallback((connectionId: string, database?: string, initialQuery = ''): void => {
    const id = crypto.randomUUID()
    const tab: QueryTabState = {
      id,
      title: `Query ${queryNumberRef.current++}`,
      connectionId,
      database,
      unsaved: false,
      loading: false,
      result: null,
      error: null,
      running: false
    }
    draftsRef.current.set(id, initialQuery)
    setTabs((current) => [...current, tab])
    setActiveTabId(id)
  }, [])

  const closeTabs = useCallback((tabId: string, scope: CloseTabScope = 'tab'): void => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === tabId)
      const removedIds = tabIdsForCloseScope(current, tabId, scope)
      removedIds.forEach((removedId) => draftsRef.current.delete(removedId))
      const remaining = current.filter((tab) => !removedIds.has(tab.id))
      setActiveTabId((currentId) => {
        if (currentId && !removedIds.has(currentId)) return currentId
        return remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.id ?? null
      })
      return remaining
    })
  }, [])

  const closeTabsForConnection = useCallback((connectionId: string): void => {
    setTabs((current) => {
      const removedIds = new Set(current.filter((tab) => tab.connectionId === connectionId).map((tab) => tab.id))
      removedIds.forEach((tabId) => draftsRef.current.delete(tabId))
      const remaining = current.filter((tab) => !removedIds.has(tab.id))
      setActiveTabId((currentId) => currentId && !removedIds.has(currentId) ? currentId : remaining[0]?.id ?? null)
      return remaining
    })
  }, [])

  useEffect(() => window.latch.onCloseActiveTab(() => {
    if (activeTabIdRef.current) closeTabs(activeTabIdRef.current)
  }), [closeTabs])

  const updateDraft = useCallback((tabId: string, query: string): void => {
    draftsRef.current.set(tabId, query)
    schedulePersist()
  }, [schedulePersist])

  const queryForTab = useCallback((tabId: string): string => draftsRef.current.get(tabId) ?? '', [])

  const changeDatabase = useCallback((tabId: string, database: string): void => {
    setTabs((current) => updateQueryTab(current, tabId, { database, result: null, error: null }))
  }, [])

  const reconcileDatabases = useCallback((connection: Connection, databases: string[], fallback?: string): void => {
    setTabs((current) => {
      let changed = false
      const next = current.map((tab) => {
        if (tab.connectionId !== connection.id || (tab.database && databases.includes(tab.database))) return tab
        changed = true
        return { ...tab, database: fallback, result: null, error: null }
      })
      return changed ? next : current
    })
  }, [])

  const clearResults = useCallback((tabId: string): void => {
    setTabs((current) => updateQueryTab(current, tabId, { result: null, error: null }))
  }, [])

  const runQuery = useCallback(async (tabId: string, sql: string): Promise<void> => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || tab.running || !sql.trim()) return
    const connectionId = tab.connectionId
    if (connectionId === null) return

    setTabs((current) => updateQueryTab(current, tabId, { running: true, error: null }))
    try {
      const result = await window.latch.executeQuery(connectionId, tab.database, sql)
      setTabs((current) => updateQueryTab(current, tabId, { result, error: null }))
      if (mayChangeSchema(sql)) onSchemaChangedRef.current(connectionId, tab.database)
    } catch (error) {
      setTabs((current) => updateQueryTab(current, tabId, { result: null, error: readableErrorMessage(error) }))
    } finally {
      setTabs((current) => updateQueryTab(current, tabId, { running: false }))
    }
  }, [])

  return {
    tabs,
    activeTabId,
    activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
    initialize,
    openQuery,
    closeTabs,
    closeTabsForConnection,
    selectTab: setActiveTabId,
    updateDraft,
    queryForTab,
    changeDatabase,
    reconcileDatabases,
    clearResults,
    runQuery
  }
}
