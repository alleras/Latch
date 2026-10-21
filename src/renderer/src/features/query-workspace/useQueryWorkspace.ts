import { useCallback, useEffect, useRef, useState } from 'react'
import type { Connection, SqlFile, SqlFileEncoding } from '../../../../shared/types'
import { mayChangeSchema } from '../../../../shared/sql'
import type { ConfirmationRequest } from '../../components/ConfirmDialog'
import type { Notice } from '../../components/NoticeSnackbar'
import type { SqlEditorHandle } from '../../components/SqlEditor'
import { readableErrorMessage } from '../../errors'
import {
  defaultSavePath,
  encodingLabel,
  fileTitle,
  findTabForPath,
  partitionTabsForRemovedConnection,
  saveLeavesTabClean,
  unsavedFileTabs,
  unsavedTabsInQueue
} from '../../query-files'
import {
  nextActiveTabId,
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

/** A connection, and the database on it, that a tab runs against. */
export interface ConnectionTarget {
  connectionId: string
  database?: string
}

interface UseQueryWorkspaceOptions {
  onSchemaChanged: (connectionId: string, database?: string) => void
  /** What the database explorer shows. New file tabs target it, and connectionless tabs adopt it on a user action. */
  explorerTarget: ConnectionTarget | null
}

export function useQueryWorkspace({ onSchemaChanged, explorerTarget }: UseQueryWorkspaceOptions) {
  const [tabs, setTabs] = useState<QueryTabState[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  /** Messages about file operations, shown one at a time, oldest first. Query errors use the per-tab error area instead. */
  const [notices, setNotices] = useState<Notice[]>([])
  /** The unsaved file tab currently being asked about during a close; `saving` while its Save answer runs. */
  const [closePrompt, setClosePrompt] = useState<{ tabId: string; title: string; saving: boolean } | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const confirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  /** A close in progress: every tab to close, where to land afterwards, and the unsaved tabs still to ask about. */
  const pendingCloseRef = useRef<{ ids: Set<string>; anchorIndex: number; queue: string[] } | null>(null)
  /** True while a Save answered from the close prompt is writing; further answers wait for it. */
  const closeSavingRef = useRef(false)
  /** Debounced unsaved-edit backup writes, one per file tab. */
  const backupTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  /**
   * File tabs whose Monaco model does not start from the text on disk: restored from a backup, or left
   * behind by a failed save. Version ids cannot tell when an edit returns to the saved state, so they
   * stay unsaved until saved.
   */
  const unknownBaselineRef = useRef(new Set<string>())
  /** The mounted SQL editor. Owned here so save and reload workflows can update Monaco models. */
  const editorRef = useRef<SqlEditorHandle | null>(null)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const draftsRef = useRef(new Map<string, string>())
  const queryNumberRef = useRef(1)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initializedRef = useRef(false)
  const onSchemaChangedRef = useRef(onSchemaChanged)
  const explorerTargetRef = useRef(explorerTarget)

  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId
  onSchemaChangedRef.current = onSchemaChanged
  explorerTargetRef.current = explorerTarget

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

  const showNotice = useCallback((message: string, severity: Notice['severity'] = 'info'): void => {
    setNotices((current) => [...current, { id: crypto.randomUUID(), message, severity }])
  }, [])
  const dismissNotice = useCallback((): void => setNotices((current) => current.slice(1)), [])

  /** Asks the user to confirm through the shell's confirmation dialog. A newer request cancels an unanswered one. */
  const confirm = useCallback((request: ConfirmationRequest): Promise<boolean> => new Promise((resolve) => {
    confirmationResolverRef.current?.(false)
    confirmationResolverRef.current = resolve
    setConfirmation(request)
  }), [])

  const answerConfirmation = useCallback((confirmed: boolean): void => {
    const resolve = confirmationResolverRef.current
    confirmationResolverRef.current = null
    setConfirmation(null)
    resolve?.(confirmed)
  }, [])

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

  /** Gives a connectionless tab an execution target. Tabs that already have one are left alone. */
  const attachConnection = useCallback((tabId: string, connectionId: string, database?: string): void => {
    setTabs((current) => {
      const tab = current.find((candidate) => candidate.id === tabId)
      if (!tab || tab.connectionId !== null) return current
      return updateQueryTab(current, tabId, { connectionId, database, result: null, error: null })
    })
  }, [])

  /**
   * A connectionless tab adopts the explorer's connection only when the user activates it: clicking it,
   * closing the tab before it, or opening its file again. Activations the app makes on its own (restoring
   * at launch, removing a connection, dropping a file that failed to reload) never call this.
   */
  const adoptExplorerTarget = useCallback((tabId: string): void => {
    const target = explorerTargetRef.current
    if (target) attachConnection(tabId, target.connectionId, target.database)
  }, [attachConnection])

  /** A sidebar pick or a newly added connection goes to the active tab if it has none. Returns true when it did. */
  const adoptConnection = useCallback((connectionId: string, database?: string): boolean => {
    const active = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
    if (!active || active.connectionId !== null) return false
    attachConnection(active.id, connectionId, database)
    return true
  }, [attachConnection])

  /** Activation by the user, from the tab strip. */
  const selectTab = useCallback((tabId: string): void => {
    if (tabId === activeTabIdRef.current) return
    setActiveTabId(tabId)
    adoptExplorerTarget(tabId)
  }, [adoptExplorerTarget])

  /**
   * Opens files into tabs that target the explorer's connection. A file that is already open is
   * activated rather than reopened, so two tabs never share a path. The last file processed ends up active.
   */
  const openFiles = useCallback((files: SqlFile[]): void => {
    const target = explorerTargetRef.current
    const openedThisBatch = new Map<string, string>()
    let reactivatedId: string | null = null
    for (const file of files) {
      const existingId = openedThisBatch.get(file.path) ?? findTabForPath(tabsRef.current, file.path, window.latch.platform)?.id
      if (existingId) {
        setActiveTabId(existingId)
        reactivatedId = existingId
        continue
      }
      const id = crypto.randomUUID()
      const tab: QueryTabState = {
        id,
        title: fileTitle(file.path),
        connectionId: target?.connectionId ?? null,
        database: target?.database,
        filePath: file.path,
        encoding: file.encoding,
        unsaved: false,
        loading: false,
        result: null,
        error: null,
        running: false
      }
      draftsRef.current.set(id, file.content)
      openedThisBatch.set(file.path, id)
      reactivatedId = null
      setTabs((current) => [...current, tab])
      setActiveTabId(id)
    }
    // Opening a file that is already open is a user activation of its tab.
    if (reactivatedId && reactivatedId !== activeTabIdRef.current) adoptExplorerTarget(reactivatedId)
  }, [adoptExplorerTarget])

  const openFilesFromDialog = useCallback(async (): Promise<void> => {
    try {
      const files = await window.latch.openSqlFiles()
      if (files.length > 0) openFiles(files)
    } catch (error) {
      showNotice(readableErrorMessage(error), 'warning')
    }
  }, [openFiles, showNotice])

  /**
   * Removes tabs along with their drafts and any unsaved-edit backups. When the active tab is
   * among them, the tab at `anchorIndex` in the remaining list becomes active.
   */
  const removeTabs = useCallback((ids: Set<string>, anchorIndex = 0): void => {
    if (ids.size === 0) return
    const knownTabs = new Map(tabsRef.current.map((tab) => [tab.id, tab]))
    ids.forEach((id) => {
      draftsRef.current.delete(id)
      cancelBackup(id)
      unknownBaselineRef.current.delete(id)
      // Only file tabs have backups. A tab not rendered yet counts as one, to be safe.
      const tab = knownTabs.get(id)
      if (!tab || tab.filePath !== undefined) void window.latch.deleteDraftBackup(id).catch(() => undefined)
    })
    setTabs((current) => {
      setActiveTabId((currentId) => nextActiveTabId(current, currentId, ids, anchorIndex))
      return current.filter((tab) => !ids.has(tab.id))
    })
  }, [cancelBackup])

  /** Closes tabs the user asked to close. The tab that becomes active is a user activation. */
  const closeTabs = useCallback((ids: Set<string>, anchorIndex: number): void => {
    const previousId = activeTabIdRef.current
    const nextId = nextActiveTabId(tabsRef.current, previousId, ids, anchorIndex)
    removeTabs(ids, anchorIndex)
    if (nextId && nextId !== previousId) adoptExplorerTarget(nextId)
  }, [adoptExplorerTarget, removeTabs])

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

  /**
   * Writes a tab's text to `path` in the tab's encoding. A file tab's text is backed up first, so a write
   * that fails partway (a full disk, a dropped network share) can cost the file's old contents but never
   * the tab's text; after a failed write the tab stays unsaved. Resolves to the version written and the
   * encoding the file now has.
   */
  const writeTab = useCallback(async (tab: QueryTabState, path: string): Promise<{ capturedVersion: number | null; encoding: SqlFileEncoding }> => {
    // Capture text and version together, before any write, so typing during the write stays unsaved.
    const draft = draftsRef.current.get(tab.id) ?? ''
    const capturedVersion = editorRef.current?.getVersionId(tab.id) ?? null
    const requested = tab.encoding ?? 'utf8'
    const isFile = tab.filePath !== undefined
    if (isFile) {
      cancelBackup(tab.id)
      await window.latch.writeDraftBackup(tab.id, draft).catch((error: unknown) => {
        console.error('Failed to back up edits before saving.', error)
      })
    }
    let encoding: SqlFileEncoding
    try {
      encoding = await window.latch.writeSqlFile(path, draft, requested)
    } catch (error) {
      if (isFile) {
        // The file may now be truncated, so its text on disk is unknown; the backup holds the tab's text.
        unknownBaselineRef.current.add(tab.id)
        setTabs((current) => updateQueryTab(current, tab.id, { unsaved: true }))
      }
      throw error
    }
    if (encoding !== requested) {
      showNotice(`${fileTitle(path)} has characters ${encodingLabel(requested)} cannot store, so it was saved as ${encodingLabel(encoding)}.`)
    }
    return { capturedVersion, encoding }
  }, [cancelBackup, showNotice])

  /** A tab whose text is still loading, or failed to load, has nothing safe to save yet. */
  const refuseLoadingSave = useCallback((tab: QueryTabState): boolean => {
    if (!tab.loading) return false
    showNotice(`${tab.title} cannot be saved until its text has loaded.`, 'warning')
    return true
  }, [showNotice])

  const saveTabAs = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || refuseLoadingSave(tab)) return false
    try {
      const path = await window.latch.chooseSqlFilePath(defaultSavePath(tab))
      if (!path) return false
      const other = findTabForPath(tabsRef.current, path, window.latch.platform)
      if (other && other.id !== tabId && other.unsaved) {
        const replace = await confirm({
          title: `Replace ${other.title}?`,
          message: `${other.title} is open in another tab with unsaved changes. Saving here closes that tab and its changes are lost.`,
          confirmLabel: 'Replace'
        })
        if (!replace) return false
      }
      // The tab may have changed or closed while the dialogs were up.
      const current = tabsRef.current.find((candidate) => candidate.id === tabId)
      if (!current) return false
      const { capturedVersion, encoding } = await writeTab(current, path)
      // Two tabs never share a path: the file now holds what was just saved, so the other tab goes.
      const duplicate = findTabForPath(tabsRef.current, path, window.latch.platform)
      if (duplicate && duplicate.id !== tabId) removeTabs(new Set([duplicate.id]))
      setTabs((tabs) => updateQueryTab(tabs, tabId, { filePath: path, title: fileTitle(path), encoding }))
      return await markTabSaved(tabId, capturedVersion)
    } catch (error) {
      showNotice(`${tab.title} could not be saved: ${readableErrorMessage(error)}`, 'warning')
      return false
    }
  }, [confirm, markTabSaved, refuseLoadingSave, removeTabs, showNotice, writeTab])

  /**
   * Writes a file tab back to disk. An untitled tab asks for a location first. Resolves to whether the
   * tab is clean afterwards: false when cancelled, when the write failed, or when the user kept typing
   * during the write (the file holds the earlier text and the tab stays unsaved).
   */
  const saveTab = useCallback(async (tabId: string): Promise<boolean> => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    if (!tab || refuseLoadingSave(tab)) return false
    if (tab.filePath === undefined) return saveTabAs(tabId)
    try {
      const { capturedVersion, encoding } = await writeTab(tab, tab.filePath)
      if (encoding !== tab.encoding) setTabs((current) => updateQueryTab(current, tabId, { encoding }))
      return await markTabSaved(tabId, capturedVersion)
    } catch (error) {
      showNotice(`${tab.title} could not be saved: ${readableErrorMessage(error)}`, 'warning')
      return false
    }
  }, [markTabSaved, refuseLoadingSave, saveTabAs, showNotice, writeTab])

  useEffect(() => window.latch.onMenuCommand((command) => {
    const activeId = activeTabIdRef.current
    if (command === 'open-file') void openFilesFromDialog()
    else if (command === 'save' && activeId) void saveTab(activeId)
    else if (command === 'save-as' && activeId) void saveTabAs(activeId)
  }), [openFilesFromDialog, saveTab, saveTabAs])

  /**
   * Fills in the text of file tabs restored from a previous launch. Clean tabs read their file; tabs
   * with unsaved edits read their backup, falling back to the file only when the backup is gone. Also
   * trims file access and old backups down to what the restored tabs still use. Runs once, at launch.
   */
  const loadRestoredFiles = useCallback((): void => {
    const fileTabs = tabsRef.current.filter((tab) => tab.filePath !== undefined)
    void window.latch.retainFileAccess(fileTabs.flatMap((tab) => tab.filePath ?? [])).catch(console.error)
    void window.latch.pruneDraftBackups(fileTabs.map((tab) => tab.id)).catch(console.error)
    for (const tab of fileTabs) {
      if (!tab.loading || tab.filePath === undefined) continue
      const { id, title, filePath, unsaved } = tab
      const isOpen = (): boolean => tabsRef.current.some((candidate) => candidate.id === id)
      void (async () => {
        let text: string | null = null
        let encoding = tab.encoding
        if (unsaved) {
          try {
            text = await window.latch.readDraftBackup(id)
          } catch (error) {
            // The backup exists but cannot be read. It is left untouched and the tab stays read-only and
            // unsaved, so nothing overwrites the backup and the next launch tries again.
            if (!isOpen()) return
            const reason = readableErrorMessage(error)
            setTabs((current) => updateQueryTab(current, id, {
              loadError: `Unsaved edits could not be read (${reason}). They are kept: relaunch Latch to try again, or close this tab and choose Don't Save to discard them.`
            }))
            showNotice(`Unsaved edits for ${title} could not be read. They are kept; relaunch Latch to try again.`, 'warning')
            return
          }
          if (text !== null) unknownBaselineRef.current.add(id)
          else showNotice(`Unsaved edits for ${title} could not be recovered.`, 'warning')
        }
        try {
          if (text === null) ({ content: text, encoding } = await window.latch.readSqlFile(filePath))
        } catch (error) {
          removeTabs(new Set([id]))
          showNotice(`${title} could not be reopened: ${readableErrorMessage(error)}`, 'warning')
          return
        }
        if (!isOpen()) return
        draftsRef.current.set(id, text)
        editorRef.current?.replaceQuery(id, text)
        setTabs((current) => updateQueryTab(current, id, { loading: false, unsaved: unknownBaselineRef.current.has(id), encoding }))
      })()
    }
  }, [removeTabs, showNotice])

  /** Shows the prompt for the next queued tab, or closes everything once no queued tab needs an answer. */
  const continuePendingClose = useCallback((): void => {
    const pending = pendingCloseRef.current
    if (!pending) return
    // Tabs closed or saved since the close began need no answer.
    const queue = unsavedTabsInQueue(tabsRef.current, pending.queue)
    const nextId = queue[0]
    if (nextId === undefined) {
      pendingCloseRef.current = null
      setClosePrompt(null)
      closeTabs(pending.ids, pending.anchorIndex)
      return
    }
    pendingCloseRef.current = { ...pending, queue }
    const title = tabsRef.current.find((candidate) => candidate.id === nextId)?.title ?? 'file'
    setClosePrompt({ tabId: nextId, title, saving: false })
  }, [closeTabs])

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
      closeTabs(ids, anchorIndex)
      return
    }
    pendingCloseRef.current = { ids, anchorIndex, queue }
    continuePendingClose()
  }, [closeTabs, continuePendingClose])

  const answerClosePrompt = useCallback((answer: 'save' | 'discard' | 'cancel'): void => {
    const pending = pendingCloseRef.current
    if (!pending || closeSavingRef.current) return
    const [currentId, ...rest] = pending.queue
    // Both only act on the close this answer belongs to, never on one started later.
    const stop = (): void => {
      if (pendingCloseRef.current !== pending) return
      pendingCloseRef.current = null
      setClosePrompt(null)
    }
    const advance = (): void => {
      if (pendingCloseRef.current !== pending) return
      pendingCloseRef.current = { ...pending, queue: rest }
      continuePendingClose()
    }
    if (answer === 'cancel' || currentId === undefined) {
      stop()
      return
    }
    // A tab that closed while it was being asked about needs no answer.
    if (answer === 'discard' || !tabsRef.current.some((tab) => tab.id === currentId)) {
      advance()
      return
    }
    closeSavingRef.current = true
    setClosePrompt((prompt) => prompt && { ...prompt, saving: true })
    void saveTab(currentId).catch(() => false).then((saved) => {
      closeSavingRef.current = false
      // A failed or cancelled save keeps the tab and stops the batch, exactly like Cancel. saveTab has
      // already said why.
      if (saved) advance()
      else stop()
    })
  }, [continuePendingClose, saveTab])

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
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
    const isFile = tab?.filePath !== undefined
    // Only file tabs carry an unsaved marker; a tab without a known baseline keeps it until saved.
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
    notice: notices[0] ?? null,
    dismissNotice,
    closePrompt,
    answerClosePrompt,
    confirmation,
    answerConfirmation,
    initialize,
    loadRestoredFiles,
    openQuery,
    requestCloseTabs,
    adoptConnection,
    releaseConnection,
    selectTab,
    updateDraft,
    queryForTab,
    changeDatabase,
    reconcileDatabases,
    clearResults,
    runQuery
  }
}
