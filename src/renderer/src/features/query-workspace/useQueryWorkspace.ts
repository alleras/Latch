import { useCallback, useEffect, useRef, useState } from 'react'
import type { Connection, SqlFile } from '../../../../shared/types'
import { mayChangeSchema } from '../../../../shared/sql'
import type { SqlEditorHandle } from '../../components/SqlEditor'
import { readableErrorMessage } from '../../errors'
import { defaultSavePath, fileTitle, findTabForPath, partitionTabsForRemovedConnection, unsavedFileTabs } from '../../query-files'
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
  /** A dismissable message about a file operation; query errors use the per-tab error area instead. */
  const [notice, setNotice] = useState<string | null>(null)
  /** The unsaved file tab currently being asked about during a close. */
  const [closePrompt, setClosePrompt] = useState<{ tabId: string; title: string } | null>(null)
  /** A close in progress: every tab to close, where to land afterwards, and the unsaved tabs still to ask about. */
  const pendingCloseRef = useRef<{ ids: Set<string>; anchorIndex: number; queue: string[] } | null>(null)
  /** The mounted SQL editor. Owned here so save and reload workflows can update Monaco models. */
  const editorRef = useRef<SqlEditorHandle | null>(null)
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

  const showNotice = useCallback((message: string): void => setNotice(message), [])
  const dismissNotice = useCallback((): void => setNotice(null), [])

  /**
   * Opens files into tabs. A file that is already open is activated rather than reopened,
   * so two tabs never share a path. The last file processed ends up active.
   */
  const openFiles = useCallback((files: SqlFile[], connectionId: string | null, database?: string): void => {
    const openedThisBatch = new Map<string, string>()
    for (const file of files) {
      const existingId = openedThisBatch.get(file.path) ?? findTabForPath(tabsRef.current, file.path)?.id
      if (existingId) {
        setActiveTabId(existingId)
        continue
      }
      const id = crypto.randomUUID()
      const tab: QueryTabState = {
        id,
        title: fileTitle(file.path),
        connectionId,
        database,
        filePath: file.path,
        unsaved: false,
        loading: false,
        result: null,
        error: null,
        running: false
      }
      draftsRef.current.set(id, file.content)
      openedThisBatch.set(file.path, id)
      setTabs((current) => [...current, tab])
      setActiveTabId(id)
    }
  }, [])

  /**
   * Removes tabs along with their drafts and any unsaved-edit backups. When the active tab is
   * among them, the tab at `anchorIndex` in the remaining list becomes active.
   */
  const removeTabs = useCallback((ids: Set<string>, anchorIndex = 0): void => {
    if (ids.size === 0) return
    ids.forEach((id) => {
      draftsRef.current.delete(id)
      void window.latch.deleteDraftBackup(id).catch(() => undefined)
    })
    setTabs((current) => {
      const remaining = current.filter((tab) => !ids.has(tab.id))
      setActiveTabId((currentId) => {
        if (currentId && !ids.has(currentId)) return currentId
        return remaining[Math.min(Math.max(anchorIndex, 0), remaining.length - 1)]?.id ?? null
      })
      return remaining
    })
  }, [])

  const saveTabAs = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || tab.loading) return false
    try {
      const path = await window.latch.chooseSqlFilePath(defaultSavePath(tab))
      if (!path) return false
      await window.latch.writeSqlFile(path, draftsRef.current.get(tabId) ?? '')
      // Two tabs never share a path: the file now holds what was just saved, so the other tab goes.
      const duplicate = findTabForPath(tabsRef.current, path)
      if (duplicate && duplicate.id !== tabId) removeTabs(new Set([duplicate.id]))
      editorRef.current?.markSaved(tabId)
      setTabs((current) => updateQueryTab(current, tabId, { filePath: path, title: fileTitle(path), unsaved: false }))
      await window.latch.deleteDraftBackup(tabId).catch(() => undefined)
      return true
    } catch (error) {
      showNotice(readableErrorMessage(error))
      return false
    }
  }, [removeTabs, showNotice])

  /** Writes a file tab back to disk. An untitled tab asks for a location first. */
  const saveTab = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || tab.loading) return false
    if (tab.filePath === undefined) return saveTabAs(tabId)
    try {
      await window.latch.writeSqlFile(tab.filePath, draftsRef.current.get(tabId) ?? '')
      editorRef.current?.markSaved(tabId)
      setTabs((current) => updateQueryTab(current, tabId, { unsaved: false }))
      await window.latch.deleteDraftBackup(tabId).catch(() => undefined)
      return true
    } catch (error) {
      showNotice(readableErrorMessage(error))
      return false
    }
  }, [saveTabAs, showNotice])

  /** Shows the prompt for the next queued tab, or closes everything once the queue is empty. */
  const continuePendingClose = useCallback((): void => {
    const pending = pendingCloseRef.current
    if (!pending) return
    const nextId = pending.queue[0]
    if (nextId === undefined) {
      pendingCloseRef.current = null
      setClosePrompt(null)
      removeTabs(pending.ids, pending.anchorIndex)
      return
    }
    const tab = tabsRef.current.find((candidate) => candidate.id === nextId)
    setClosePrompt({ tabId: nextId, title: tab?.title ?? 'file' })
  }, [removeTabs])

  /**
   * Every way of closing tabs goes through here. Unsaved file tabs in the set are asked about one at
   * a time, in tab order; only after every answer do the tabs close together. Cancel closes nothing.
   */
  const requestCloseTabs = useCallback((tabId: string, scope: CloseTabScope = 'tab'): void => {
    if (pendingCloseRef.current) return
    const current = tabsRef.current
    const ids = tabIdsForCloseScope(current, tabId, scope)
    if (ids.size === 0) return
    const anchorIndex = Math.max(current.findIndex((tab) => tab.id === tabId), 0)
    const queue = unsavedFileTabs(current, ids).map((tab) => tab.id)
    if (queue.length === 0) {
      removeTabs(ids, anchorIndex)
      return
    }
    pendingCloseRef.current = { ids, anchorIndex, queue }
    continuePendingClose()
  }, [continuePendingClose, removeTabs])

  const answerClosePrompt = useCallback((answer: 'save' | 'discard' | 'cancel'): void => {
    const pending = pendingCloseRef.current
    if (!pending) return
    const [currentId, ...rest] = pending.queue
    const cancel = (): void => {
      pendingCloseRef.current = null
      setClosePrompt(null)
    }
    if (answer === 'cancel' || currentId === undefined) {
      cancel()
      return
    }
    const advance = (): void => {
      if (pendingCloseRef.current !== pending) return
      pendingCloseRef.current = { ...pending, queue: rest }
      continuePendingClose()
    }
    if (answer === 'discard') {
      advance()
      return
    }
    // A failed or cancelled save keeps the tab and stops the batch, exactly like Cancel.
    void saveTab(currentId).then((saved) => (saved ? advance() : cancel()))
  }, [continuePendingClose, saveTab])

  /** Gives a connectionless tab an execution target. Tabs that already have one are left alone. */
  const attachConnection = useCallback((tabId: string, connectionId: string, database?: string): void => {
    setTabs((current) => {
      const tab = current.find((candidate) => candidate.id === tabId)
      if (!tab || tab.connectionId !== null) return current
      return updateQueryTab(current, tabId, { connectionId, database, result: null, error: null })
    })
  }, [])

  /** A removed connection closes its untitled tabs and detaches its file tabs, which keep their text. */
  const releaseConnection = useCallback((connectionId: string): void => {
    setTabs((current) => {
      const { detach, close } = partitionTabsForRemovedConnection(current, connectionId)
      if (detach.size === 0 && close.size === 0) return current
      close.forEach((tabId) => draftsRef.current.delete(tabId))
      const remaining = current
        .filter((tab) => !close.has(tab.id))
        .map((tab) => detach.has(tab.id) ? { ...tab, connectionId: null, database: undefined, result: null, error: null } : tab)
      setActiveTabId((currentId) => currentId && !close.has(currentId) ? currentId : remaining[0]?.id ?? null)
      return remaining
    })
  }, [])

  useEffect(() => window.latch.onCloseActiveTab(() => {
    if (activeTabIdRef.current) requestCloseTabs(activeTabIdRef.current)
  }), [requestCloseTabs])

  const updateDraft = useCallback((tabId: string, query: string, unsaved: boolean): void => {
    draftsRef.current.set(tabId, query)
    setTabs((current) => {
      const tab = current.find((candidate) => candidate.id === tabId)
      // Only file tabs carry an unsaved marker, and the tab list only rerenders when it flips.
      const nextUnsaved = unsaved && tab?.filePath !== undefined
      if (!tab || tab.unsaved === nextUnsaved) return current
      return updateQueryTab(current, tabId, { unsaved: nextUnsaved })
    })
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
    editorRef,
    notice,
    showNotice,
    dismissNotice,
    initialize,
    openQuery,
    openFiles,
    saveTab,
    saveTabAs,
    requestCloseTabs,
    closePrompt,
    answerClosePrompt,
    attachConnection,
    releaseConnection,
    selectTab: setActiveTabId,
    updateDraft,
    queryForTab,
    changeDatabase,
    reconcileDatabases,
    clearResults,
    runQuery
  }
}
