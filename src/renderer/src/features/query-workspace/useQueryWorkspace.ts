import { useCallback, useEffect, useRef, useState } from 'react'
import type { Connection, SqlFile } from '../../../../shared/types'
import { mayChangeSchema } from '../../../../shared/sql'
import type { SqlEditorHandle } from '../../components/SqlEditor'
import { createActivationGuard } from '../../activation-guard'
import { readableErrorMessage } from '../../errors'
import {
  defaultSavePath,
  fileTitle,
  findTabForPath,
  partitionTabsForRemovedConnection,
  saveLeavesTabClean,
  unsavedFileTabs
} from '../../query-files'
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
  /** Debounced unsaved-edit backup writes, one per file tab. */
  const backupTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  /**
   * File tabs restored from a backup. Their Monaco model holds the backup text, not the saved text,
   * so version ids cannot tell when an edit returns to the saved state; they stay unsaved until saved.
   */
  const unknownBaselineRef = useRef(new Set<string>())
  /** Lets the shell tell user-caused tab activations (which may adopt a connection) from app-caused ones. */
  const activationGuardRef = useRef(createActivationGuard())
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

  const cancelBackup = useCallback((tabId: string): void => {
    const timer = backupTimersRef.current.get(tabId)
    if (timer === undefined) return
    clearTimeout(timer)
    backupTimersRef.current.delete(tabId)
  }, [])

  /** Writes the tab's draft to its backup file after a pause in typing, so quitting never loses edits. */
  const scheduleBackup = useCallback((tabId: string): void => {
    cancelBackup(tabId)
    backupTimersRef.current.set(tabId, setTimeout(() => {
      backupTimersRef.current.delete(tabId)
      const draft = draftsRef.current.get(tabId)
      if (draft === undefined) return
      void window.latch.writeDraftBackup(tabId, draft).catch((error: unknown) => {
        console.error('Failed to back up unsaved edits.', error)
      })
    }, PERSIST_DELAY_MS))
  }, [cancelBackup])

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
    // Restoring the active tab at launch is not a user action; a connectionless tab stays that way.
    if (restoredActiveTabId) activationGuardRef.current.suppress(restoredActiveTabId)
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
    const flush = (): void => {
      // Every unsaved file tab is written synchronously so nothing depends on an async write finishing first.
      for (const tab of tabsRef.current) {
        if (tab.filePath === undefined || !tab.unsaved) continue
        cancelBackup(tab.id)
        const draft = draftsRef.current.get(tab.id)
        if (draft !== undefined) window.latch.writeDraftBackupSync(tab.id, draft)
      }
      persist()
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      persist()
    }
  }, [cancelBackup, persist])

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

  /** For the shell's activation trigger: true only for activations the user caused. Consumes one suppression. */
  const adoptionAllowedForActivation = useCallback((tabId: string | null): boolean => activationGuardRef.current.shouldAdopt(tabId), [])

  const showNotice = useCallback((message: string): void => setNotice(message), [])
  const dismissNotice = useCallback((): void => setNotice(null), [])

  /**
   * Opens files into tabs. A file that is already open is activated rather than reopened,
   * so two tabs never share a path. The last file processed ends up active.
   */
  const openFiles = useCallback((files: SqlFile[], connectionId: string | null, database?: string): void => {
    const openedThisBatch = new Map<string, string>()
    for (const file of files) {
      const existingId = openedThisBatch.get(file.path) ?? findTabForPath(tabsRef.current, file.path, window.latch.platform)?.id
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
  const removeTabs = useCallback((ids: Set<string>, anchorIndex = 0, userInitiated = true): void => {
    if (ids.size === 0) return
    ids.forEach((id) => {
      draftsRef.current.delete(id)
      cancelBackup(id)
      unknownBaselineRef.current.delete(id)
      void window.latch.deleteDraftBackup(id).catch(() => undefined)
    })
    setTabs((current) => {
      const remaining = current.filter((tab) => !ids.has(tab.id))
      setActiveTabId((currentId) => {
        if (currentId && !ids.has(currentId)) return currentId
        const nextId = remaining[Math.min(Math.max(anchorIndex, 0), remaining.length - 1)]?.id ?? null
        if (!userInitiated && nextId) activationGuardRef.current.suppress(nextId)
        return nextId
      })
      return remaining
    })
  }, [cancelBackup])

  /**
   * After a write, the version captured when the save started is the saved baseline. The tab is clean
   * only if nothing was typed during the write; otherwise it stays unsaved and keeps its backup.
   * Returns whether the tab is clean.
   */
  const markTabSaved = useCallback(async (tabId: string, capturedVersion: number | null): Promise<boolean> => {
    const clean = saveLeavesTabClean(capturedVersion, editorRef.current?.getVersionId(tabId) ?? null)
    editorRef.current?.markSaved(tabId, capturedVersion ?? undefined)
    unknownBaselineRef.current.delete(tabId)
    setTabs((current) => updateQueryTab(current, tabId, { unsaved: !clean }))
    if (clean) {
      cancelBackup(tabId)
      await window.latch.deleteDraftBackup(tabId).catch(() => undefined)
    } else {
      scheduleBackup(tabId)
    }
    return clean
  }, [cancelBackup, scheduleBackup])

  const saveTabAs = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || tab.loading) return false
    try {
      const path = await window.latch.chooseSqlFilePath(defaultSavePath(tab))
      if (!path) return false
      // Capture text and version together, before the write, so typing during the write stays unsaved.
      const draft = draftsRef.current.get(tabId) ?? ''
      const capturedVersion = editorRef.current?.getVersionId(tabId) ?? null
      await window.latch.writeSqlFile(path, draft)
      // Two tabs never share a path: the file now holds what was just saved, so the other tab goes.
      const duplicate = findTabForPath(tabsRef.current, path, window.latch.platform)
      if (duplicate && duplicate.id !== tabId) removeTabs(new Set([duplicate.id]))
      setTabs((current) => updateQueryTab(current, tabId, { filePath: path, title: fileTitle(path) }))
      return await markTabSaved(tabId, capturedVersion)
    } catch (error) {
      showNotice(readableErrorMessage(error))
      return false
    }
  }, [markTabSaved, removeTabs, showNotice])

  /**
   * Writes a file tab back to disk. An untitled tab asks for a location first. Resolves to whether the
   * tab is clean afterwards: false when cancelled, when the write failed, or when the user kept typing
   * during the write (the file holds the earlier text and the tab stays unsaved).
   */
  const saveTab = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || tab.loading) return false
    if (tab.filePath === undefined) return saveTabAs(tabId)
    try {
      const draft = draftsRef.current.get(tabId) ?? ''
      const capturedVersion = editorRef.current?.getVersionId(tabId) ?? null
      await window.latch.writeSqlFile(tab.filePath, draft)
      return await markTabSaved(tabId, capturedVersion)
    } catch (error) {
      showNotice(readableErrorMessage(error))
      return false
    }
  }, [markTabSaved, saveTabAs, showNotice])

  /**
   * Fills in the text of file tabs restored from a previous launch. Clean tabs read their file; tabs
   * with unsaved edits read their backup, falling back to the file when the backup is gone.
   */
  const loadRestoredFiles = useCallback((): void => {
    for (const tab of tabsRef.current) {
      if (!tab.loading || tab.filePath === undefined) continue
      const { id, title, filePath, unsaved } = tab
      void (async () => {
        try {
          let text: string | null = null
          if (unsaved) {
            // Any failure to read the backup counts as a missing backup; the file itself may be fine.
            text = await window.latch.readDraftBackup(id).catch(() => null)
            if (text !== null) unknownBaselineRef.current.add(id)
            else showNotice(`Unsaved edits for ${title} could not be recovered.`)
          }
          if (text === null) text = (await window.latch.readSqlFile(filePath)).content
          if (!tabsRef.current.some((candidate) => candidate.id === id)) return
          draftsRef.current.set(id, text)
          editorRef.current?.replaceQuery(id, text)
          setTabs((current) => updateQueryTab(current, id, { loading: false, unsaved: unknownBaselineRef.current.has(id) }))
        } catch (error) {
          removeTabs(new Set([id]), 0, false)
          showNotice(`${title} could not be reopened: ${readableErrorMessage(error)}`)
        }
      })()
    }
  }, [removeTabs, showNotice])

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
      setActiveTabId((currentId) => {
        if (currentId && !close.has(currentId)) return currentId
        const nextId = remaining[0]?.id ?? null
        // An activation caused by the removal is not a user action; the next tab must not retarget.
        if (nextId) activationGuardRef.current.suppress(nextId)
        return nextId
      })
      return remaining
    })
  }, [])

  useEffect(() => window.latch.onCloseActiveTab(() => {
    if (activeTabIdRef.current) requestCloseTabs(activeTabIdRef.current)
  }), [requestCloseTabs])

  const updateDraft = useCallback((tabId: string, query: string, unsaved: boolean): void => {
    draftsRef.current.set(tabId, query)
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    const isFile = tab?.filePath !== undefined
    // Only file tabs carry an unsaved marker; a tab restored from a backup keeps it until saved.
    const nextUnsaved = isFile && (unsaved || unknownBaselineRef.current.has(tabId))
    if (isFile) {
      if (nextUnsaved) scheduleBackup(tabId)
      else {
        cancelBackup(tabId)
        if (tab?.unsaved) void window.latch.deleteDraftBackup(tabId).catch(() => undefined)
      }
    }
    // The tab list only rerenders when the marker flips.
    if (tab && tab.unsaved !== nextUnsaved) setTabs((current) => updateQueryTab(current, tabId, { unsaved: nextUnsaved }))
    schedulePersist()
  }, [cancelBackup, scheduleBackup, schedulePersist])

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
    loadRestoredFiles,
    openQuery,
    openFiles,
    saveTab,
    saveTabAs,
    requestCloseTabs,
    closePrompt,
    answerClosePrompt,
    adoptionAllowedForActivation,
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
