import { memo, useCallback, useEffect, useRef, useState } from 'react'
import AddRounded from '@mui/icons-material/AddRounded'
import DataObjectRounded from '@mui/icons-material/DataObjectRounded'
import HubRounded from '@mui/icons-material/HubRounded'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import SettingsRounded from '@mui/icons-material/SettingsRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { Connection, DatabaseObject, ProviderDefinition, ServerConnectionInput } from '../../shared/types'
import { mayChangeSchema } from '../../shared/sql'
import { ConnectionDialog } from './components/ConnectionDialog'
import { QueryTabs } from './components/QueryTabs'
import { ResultsPanel } from './components/ResultsPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { SqlEditor, type SqlEditorHandle } from './components/SqlEditor'
import { readableErrorMessage } from './errors'
import {
  connectionDatabaseKey,
  tabIdsForCloseScope,
  updateQueryTab,
  type CloseTabScope,
  type QueryTabState
} from './query-tabs'
import {
  createQueryWorkspaceSnapshot,
  LEGACY_QUERY_STORAGE_KEY,
  QUERY_WORKSPACE_STORAGE_KEY,
  readQueryWorkspace,
  restoreQueryWorkspace
} from './query-workspace'
import type { AppSettings } from './settings'

const STARTER_QUERY = `-- Welcome to Latch
-- Write SQL here, then press ⌘↵ to run.

SELECT 1 AS ready;`
const DRAFT_PERSIST_DELAY_MS = 500

function preferredDatabase(connection: Connection, databases: string[]): string | undefined {
  if (connection.provider === 'sqlite') return undefined
  if (connection.initialDatabase && databases.includes(connection.initialDatabase)) return connection.initialDatabase
  return databases.find((name) => !['master', 'postgres', 'mysql', 'information_schema'].includes(name)) ?? databases[0]
}

interface AppProps {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
}

interface TabResultsPanelProps {
  tab: QueryTabState
  active: boolean
  onClearTab: (tabId: string) => void
}

const TabResultsPanel = memo(function TabResultsPanel({ tab, active, onClearTab }: TabResultsPanelProps) {
  const clear = useCallback(() => onClearTab(tab.id), [onClearTab, tab.id])

  return (
    <Box
      aria-hidden={!active}
      sx={{ position: 'absolute', inset: 0, visibility: active ? 'visible' : 'hidden', pointerEvents: active ? 'auto' : 'none' }}
    >
      <ResultsPanel result={tab.result} error={tab.error} onClear={clear} />
    </Box>
  )
})

function App({ settings, onSettingsChange }: AppProps) {
  const [providers, setProviders] = useState<ProviderDefinition[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [explorerConnectionId, setExplorerConnectionId] = useState<string | null>(null)
  const [explorerDatabase, setExplorerDatabase] = useState<string | undefined>()
  const [databasesByConnection, setDatabasesByConnection] = useState<Record<string, string[]>>({})
  const [loadingDatabaseIds, setLoadingDatabaseIds] = useState<Set<string>>(new Set())
  const [schemasByContext, setSchemasByContext] = useState<Record<string, DatabaseObject[]>>({})
  const [loadingSchemaKeys, setLoadingSchemaKeys] = useState<Set<string>>(new Set())
  const [tabs, setTabs] = useState<QueryTabState[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const editorRef = useRef<SqlEditorHandle>(null)
  const queryNumberRef = useRef(1)
  const queryDraftsRef = useRef(new Map<string, string>())
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const workspaceReadyRef = useRef(false)
  const tabsRef = useRef(tabs)
  const databaseCacheRef = useRef(new Map<string, string[]>())
  const databaseRequestsRef = useRef(new Map<string, Promise<string[]>>())
  const schemaCacheRef = useRef(new Map<string, DatabaseObject[]>())
  const schemaRequestsRef = useRef(new Map<string, Promise<DatabaseObject[]>>())
  const explorerConnectionIdRef = useRef(explorerConnectionId)
  const explorerDatabaseRef = useRef(explorerDatabase)
  const activeTabIdRef = useRef(activeTabId)
  const applicationLayout = useDefaultLayout({ id: 'application-panels', storage: localStorage })
  const queryLayout = useDefaultLayout({ id: 'query-panels', storage: localStorage })

  explorerConnectionIdRef.current = explorerConnectionId
  explorerDatabaseRef.current = explorerDatabase
  activeTabIdRef.current = activeTabId
  tabsRef.current = tabs

  const explorerConnection = connections.find((connection) => connection.id === explorerConnectionId) ?? null
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const tabConnection = connections.find((connection) => connection.id === activeTab?.connectionId) ?? null
  const activeProvider = providers.find((provider) => provider.id === tabConnection?.provider)
  const explorerDatabases = explorerConnection ? databasesByConnection[explorerConnection.id] ?? [] : []
  const tabDatabases = tabConnection ? databasesByConnection[tabConnection.id] ?? [] : []
  const explorerSchema = explorerConnection
    ? schemasByContext[connectionDatabaseKey(explorerConnection.id, explorerDatabase)] ?? []
    : []
  const editorSchema = activeTab
    ? schemasByContext[connectionDatabaseKey(activeTab.connectionId, activeTab.database)] ?? []
    : []

  const persistQueryWorkspace = useCallback((): void => {
    if (!workspaceReadyRef.current) return
    const snapshot = createQueryWorkspaceSnapshot(
      tabsRef.current,
      queryDraftsRef.current,
      activeTabIdRef.current,
      explorerConnectionIdRef.current,
      explorerDatabaseRef.current
    )
    localStorage.setItem(QUERY_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot))
    localStorage.removeItem(LEGACY_QUERY_STORAGE_KEY)
  }, [])

  const scheduleWorkspacePersist = useCallback((): void => {
    if (!workspaceReadyRef.current) return
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      persistQueryWorkspace()
      draftTimerRef.current = null
    }, DRAFT_PERSIST_DELAY_MS)
  }, [persistQueryWorkspace])

  const openQuery = useCallback((connectionId: string, database?: string, initialQuery = ''): void => {
    const id = crypto.randomUUID()
    const tab: QueryTabState = {
      id,
      title: `Query ${queryNumberRef.current++}`,
      connectionId,
      database,
      result: null,
      error: null,
      running: false
    }
    queryDraftsRef.current.set(id, initialQuery)
    setTabs((current) => [...current, tab])
    setActiveTabId(id)
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

    setLoadingSchemaKeys((current) => new Set(current).add(key))
    const request = window.latch.getSchema(connectionId, database)
    schemaRequestsRef.current.set(key, request)

    try {
      const schema = await request
      schemaCacheRef.current.set(key, schema)
      setSchemasByContext((current) => ({ ...current, [key]: schema }))
      return schema
    } finally {
      schemaRequestsRef.current.delete(key)
      setLoadingSchemaKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }, [])

  const loadDatabases = useCallback(async (
    connection: Exclude<Connection, { provider: 'sqlite' }>,
    force = false
  ): Promise<string[]> => {
    const cached = databaseCacheRef.current.get(connection.id)
    if (cached && !force) return cached

    const pending = databaseRequestsRef.current.get(connection.id)
    if (pending) return pending

    setLoadingDatabaseIds((current) => new Set(current).add(connection.id))
    const request = window.latch.listDatabases(connection.id)
    databaseRequestsRef.current.set(connection.id, request)

    try {
      const items = await request
      databaseCacheRef.current.set(connection.id, items)
      setDatabasesByConnection((current) => ({ ...current, [connection.id]: items }))
      const fallback = preferredDatabase(connection, items)
      setTabs((current) => current.map((tab) => {
        if (tab.connectionId !== connection.id || (tab.database && items.includes(tab.database))) return tab
        return { ...tab, database: fallback, result: null, error: null }
      }))
      return items
    } finally {
      databaseRequestsRef.current.delete(connection.id)
      setLoadingDatabaseIds((current) => {
        const next = new Set(current)
        next.delete(connection.id)
        return next
      })
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void Promise.all([window.latch.listProviders(), window.latch.listConnections()]).then(([availableProviders, savedConnections]) => {
      if (cancelled) return
      setProviders(availableProviders)
      setConnections(savedConnections)
      const restored = restoreQueryWorkspace(
        readQueryWorkspace(localStorage.getItem(QUERY_WORKSPACE_STORAGE_KEY)),
        new Set(savedConnections.map((connection) => connection.id))
      )
      const connection = savedConnections.find((item) => item.id === restored.explorerConnectionId)
        ?? savedConnections.find((item) => item.id === restored.tabs.find((tab) => tab.id === restored.activeTabId)?.connectionId)
        ?? savedConnections[0]
      let restoredTabs = restored.tabs
      let restoredActiveTabId = restored.activeTabId
      const drafts = restored.drafts

      if (restoredTabs.length === 0 && connection) {
        const id = crypto.randomUUID()
        const legacyQuery = localStorage.getItem(LEGACY_QUERY_STORAGE_KEY) ?? STARTER_QUERY
        restoredTabs = [{
          id,
          title: 'Query 1',
          connectionId: connection.id,
          database: connection.provider === 'sqlite' ? undefined : connection.initialDatabase,
          result: null,
          error: null,
          running: false
        }]
        restoredActiveTabId = id
        drafts.set(id, legacyQuery)
      }

      const initialExplorerDatabase = connection?.id === restored.explorerConnectionId
        ? restored.explorerDatabase
        : restoredTabs.find((tab) => tab.id === restoredActiveTabId && tab.connectionId === connection?.id)?.database

      queryDraftsRef.current = drafts
      queryNumberRef.current = Math.max(restored.nextQueryNumber, restoredTabs.length > 0 ? 2 : 1)
      tabsRef.current = restoredTabs
      activeTabIdRef.current = restoredActiveTabId
      explorerConnectionIdRef.current = connection?.id ?? null
      explorerDatabaseRef.current = initialExplorerDatabase
      workspaceReadyRef.current = true
      setTabs(restoredTabs)
      setActiveTabId(restoredActiveTabId)
      setExplorerConnectionId(connection?.id ?? null)
      setExplorerDatabase(initialExplorerDatabase)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!explorerConnection) {
      setExplorerDatabase(undefined)
      return
    }

    if (explorerConnection.provider === 'sqlite') {
      setExplorerDatabase(undefined)
      return
    }

    const cached = databaseCacheRef.current.get(explorerConnection.id)
    if (cached) {
      setExplorerDatabase((current) => current && cached.includes(current) ? current : preferredDatabase(explorerConnection, cached))
    }
    void loadDatabases(explorerConnection).then((items) => {
      if (explorerConnectionIdRef.current !== explorerConnection.id) return
      setExplorerDatabase((current) => current && items.includes(current) ? current : preferredDatabase(explorerConnection, items))
    }).catch(console.error)
  }, [explorerConnection?.id, loadDatabases])

  useEffect(() => {
    if (!explorerConnection || (explorerConnection.provider !== 'sqlite' && !explorerDatabase)) return
    void loadSchema(explorerConnection.id, explorerDatabase).catch(console.error)
  }, [explorerConnection?.id, explorerConnection?.provider, explorerDatabase, loadSchema])

  useEffect(() => {
    if (!activeTab || !tabConnection) return
    if (tabConnection.provider !== 'sqlite') {
      void loadDatabases(tabConnection).then((items) => {
        if (activeTabIdRef.current !== activeTab.id) return
        if (activeTab.database && items.includes(activeTab.database)) {
          void loadSchema(tabConnection.id, activeTab.database).catch(console.error)
        }
      }).catch(console.error)
      return
    }
    void loadSchema(tabConnection.id).catch(console.error)
  }, [activeTab?.connectionId, activeTab?.database, loadDatabases, loadSchema, tabConnection?.provider])

  useEffect(() => {
    scheduleWorkspacePersist()
  }, [activeTabId, explorerConnectionId, explorerDatabase, scheduleWorkspacePersist, tabs])

  useEffect(() => {
    const flushWorkspace = (): void => persistQueryWorkspace()
    window.addEventListener('beforeunload', flushWorkspace)
    return () => {
      window.removeEventListener('beforeunload', flushWorkspace)
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      persistQueryWorkspace()
    }
  }, [persistQueryWorkspace])

  const handleQueryChange = useCallback((tabId: string, query: string): void => {
    queryDraftsRef.current.set(tabId, query)
    scheduleWorkspacePersist()
  }, [scheduleWorkspacePersist])

  const runQuery = useCallback(async (): Promise<void> => {
    if (!activeTab || !tabConnection || activeTab.running) return
    const selected = editorRef.current?.getSelectedQuery().trim()
    const sql = selected || editorRef.current?.getQuery() || ''
    if (!sql.trim()) return

    const tabId = activeTab.id
    const connectionId = activeTab.connectionId
    const database = activeTab.database
    setTabs((current) => updateQueryTab(current, tabId, { running: true, error: null }))
    try {
      const result = await window.latch.executeQuery(connectionId, database, sql)
      setTabs((current) => updateQueryTab(current, tabId, { result, error: null }))
      if (mayChangeSchema(sql)) void loadSchema(connectionId, database, true).catch(console.error)
    } catch (nextError) {
      setTabs((current) => updateQueryTab(current, tabId, { result: null, error: readableErrorMessage(nextError) }))
    } finally {
      setTabs((current) => updateQueryTab(current, tabId, { running: false }))
    }
  }, [activeTab, loadSchema, tabConnection])

  const addSqlite = async (mode: 'open' | 'create'): Promise<void> => {
    const connection = mode === 'open' ? await window.latch.openDatabase() : await window.latch.createDatabase()
    if (!connection) return
    setConnections(await window.latch.listConnections())
    setExplorerConnectionId(connection.id)
    setExplorerDatabase(undefined)
    openQuery(connection.id)
    setConnectionDialogOpen(false)
  }

  const addServerConnection = async (input: ServerConnectionInput): Promise<void> => {
    setIsConnecting(true)
    setConnectionError(null)
    try {
      const connection = await window.latch.addServerConnection(input)
      setConnections(await window.latch.listConnections())
      setExplorerConnectionId(connection.id)
      setExplorerDatabase(undefined)
      setConnectionDialogOpen(false)
    } catch (nextError) {
      setConnectionError(readableErrorMessage(nextError))
    } finally {
      setIsConnecting(false)
    }
  }

  const removeConnection = useCallback(async (id: string): Promise<void> => {
    const items = await window.latch.removeConnection(id)
    setConnections(items)
    databaseCacheRef.current.delete(id)
    for (const key of schemaCacheRef.current.keys()) {
      const [connectionId] = JSON.parse(key) as [string, string]
      if (connectionId === id) schemaCacheRef.current.delete(key)
    }
    setDatabasesByConnection((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setSchemasByContext((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => (JSON.parse(key) as [string, string])[0] !== id)
    ))
    setTabs((current) => {
      const removedIds = new Set(current.filter((tab) => tab.connectionId === id).map((tab) => tab.id))
      removedIds.forEach((tabId) => queryDraftsRef.current.delete(tabId))
      const remaining = current.filter((tab) => !removedIds.has(tab.id))
      setActiveTabId((currentId) => currentId && !removedIds.has(currentId) ? currentId : remaining[0]?.id ?? null)
      return remaining
    })
    if (explorerConnectionIdRef.current === id) {
      setExplorerConnectionId(items[0]?.id ?? null)
      setExplorerDatabase(undefined)
    }
  }, [])

  const closeQueryTabs = useCallback((tabId: string, scope: CloseTabScope = 'tab'): void => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === tabId)
      const removedIds = tabIdsForCloseScope(current, tabId, scope)
      removedIds.forEach((removedId) => queryDraftsRef.current.delete(removedId))
      const remaining = current.filter((tab) => !removedIds.has(tab.id))
      setActiveTabId((currentId) => {
        if (currentId && !removedIds.has(currentId)) return currentId
        const contextTab = remaining.find((tab) => tab.id === tabId)
        if (contextTab) return contextTab.id
        return remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.id ?? null
      })
      return remaining
    })
  }, [])

  useEffect(() => {
    return window.latch.onCloseActiveTab(() => {
      if (activeTabIdRef.current) closeQueryTabs(activeTabIdRef.current)
    })
  }, [closeQueryTabs])

  const addQueryFromExplorer = useCallback((): void => {
    if (!explorerConnection) {
      setConnectionError(null)
      setConnectionDialogOpen(true)
      return
    }
    openQuery(explorerConnection.id, explorerConnection.provider === 'sqlite' ? undefined : explorerDatabase)
  }, [explorerConnection, explorerDatabase, openQuery])

  const changeTabDatabase = useCallback((database: string): void => {
    if (!activeTabId) return
    setTabs((current) => updateQueryTab(current, activeTabId, { database, result: null, error: null }))
  }, [activeTabId])

  const selectExplorerConnection = useCallback((connectionId: string): void => {
    setExplorerConnectionId(connectionId)
    setExplorerDatabase(undefined)
  }, [])

  const selectExplorerDatabase = useCallback((database: string): void => {
    setExplorerDatabase(database)
  }, [])

  const refreshActiveDatabases = useCallback((): void => {
    if (!explorerConnection || explorerConnection.provider === 'sqlite') return
    void loadDatabases(explorerConnection, true).then((items) => {
      if (explorerConnectionIdRef.current !== explorerConnection.id) return
      setExplorerDatabase((current) => current && items.includes(current) ? current : preferredDatabase(explorerConnection, items))
    }).catch(console.error)
  }, [explorerConnection, loadDatabases])

  const refreshActiveSchema = useCallback((): void => {
    if (!explorerConnection || (explorerConnection.provider !== 'sqlite' && !explorerDatabase)) return
    void loadSchema(explorerConnection.id, explorerDatabase, true).catch(console.error)
  }, [explorerConnection, explorerDatabase, loadSchema])

  const clearTabResults = useCallback((tabId: string): void => {
    setTabs((current) => updateQueryTab(current, tabId, { result: null, error: null }))
  }, [])

  const displayConnection = tabConnection ?? explorerConnection
  const activeQuery = activeTab ? queryDraftsRef.current.get(activeTab.id) ?? '' : ''

  return (
    <Box sx={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr)', gridTemplateRows: '46px minmax(0, 1fr)', bgcolor: 'background.default' }}>
      <Stack
        component="header"
        direction="row"
        sx={{ gridColumn: '1 / -1', alignItems: 'center', px: 1.25, pl: 9.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'var(--latch-shell)', WebkitAppRegion: 'drag', userSelect: 'none' }}
      >
        <Box sx={{ width: 20, height: 20, mr: 1, display: 'grid', placeItems: 'center', borderRadius: 1, border: '1px solid', borderColor: 'primary.main', transform: 'rotate(-4deg)' }}>
          <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: 'primary.main' }} />
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: '.15em' }}>LATCH</Typography>
        <Box sx={{ height: 16, mx: 1.25, borderLeft: '1px solid', borderColor: 'divider' }} />
        <Typography variant="caption" color="text.secondary">{displayConnection?.name ?? 'SQL workspace'}</Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" sx={{ WebkitAppRegion: 'no-drag' }}><MoreHorizRounded fontSize="small" /></IconButton>
      </Stack>

      <Stack component="nav" sx={{ gridColumn: 1, gridRow: 2, alignItems: 'center', py: 1, borderRight: '1px solid', borderColor: 'divider', bgcolor: 'var(--latch-shell)' }}>
        <Tooltip title="Data sources" placement="right"><IconButton color="primary" sx={{ bgcolor: 'rgba(201,245,95,.08)' }}><StorageRounded fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="New query" placement="right"><IconButton sx={{ mt: 0.5 }} onClick={addQueryFromExplorer}><DataObjectRounded fontSize="small" /></IconButton></Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Settings" placement="right"><IconButton aria-label="Open settings" onClick={() => setSettingsDialogOpen(true)}><SettingsRounded fontSize="small" /></IconButton></Tooltip>
        <Typography variant="caption" color="text.disabled" sx={{ mt: 1, fontSize: 8, writingMode: 'vertical-rl', letterSpacing: '.1em' }}>v0.1</Typography>
      </Stack>

      <Box sx={{ gridColumn: 2, gridRow: 2, minWidth: 0, minHeight: 0 }}>
        <Group orientation="horizontal" id="application-panels" defaultLayout={applicationLayout.defaultLayout} onLayoutChanged={applicationLayout.onLayoutChanged} style={{ height: '100%' }}>
          <Panel id="sidebar" defaultSize={272} minSize={210} maxSize="42%">
            <Sidebar
              connections={connections}
              providers={providers}
              activeConnection={explorerConnection}
              activeDatabase={explorerDatabase}
              databases={explorerDatabases}
              loadingDatabases={Boolean(explorerConnection && loadingDatabaseIds.has(explorerConnection.id))}
              loadingSchema={Boolean(explorerConnection && loadingSchemaKeys.has(connectionDatabaseKey(explorerConnection.id, explorerDatabase)))}
              schema={explorerSchema}
              onAdd={() => { setConnectionError(null); setConnectionDialogOpen(true) }}
              onSelectConnection={selectExplorerConnection}
              onRemoveConnection={(id) => void removeConnection(id)}
              onSelectDatabase={selectExplorerDatabase}
              onOpenQuery={openQuery}
              onRefreshDatabases={refreshActiveDatabases}
              onRefreshSchema={refreshActiveSchema}
            />
          </Panel>

          <Separator className="resize-handle" />

          <Panel id="workspace" minSize={480}>
            <Box component="main" sx={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <QueryTabs tabs={tabs} connections={connections} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeQueryTabs} onAdd={addQueryFromExplorer} />

              {connections.length === 0 ? (
                <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 44%, rgba(201,245,95,.055), transparent 34%)' }}>
                  <Box sx={{ width: 62, height: 62, display: 'grid', placeItems: 'center', borderRadius: 2, border: '1px solid rgba(201,245,95,.28)', bgcolor: 'rgba(201,245,95,.04)', color: 'primary.main', transform: 'rotate(-3deg)', boxShadow: '0 24px 80px rgba(0,0,0,.4)' }}><HubRounded sx={{ fontSize: 28 }} /></Box>
                  <Typography variant="overline" color="primary.main" sx={{ mt: 3 }}>Your SQL workbench</Typography>
                  <Typography variant="h2" align="center" sx={{ mt: 0.5, fontSize: { xs: 38, lg: 54 }, fontWeight: 500, lineHeight: 1, letterSpacing: '-.045em' }}>Every database.<br /><Box component="span" sx={{ color: 'primary.main', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 400 }}>One close connection.</Box></Typography>
                  <Typography variant="body2" align="center" color="text.secondary" sx={{ mt: 2, maxWidth: 430, lineHeight: 1.7 }}>Explore database objects and run queries across PostgreSQL, MySQL, SQL Server, Azure SQL, and SQLite.</Typography>
                  <Button variant="contained" size="large" startIcon={<AddRounded />} onClick={() => setConnectionDialogOpen(true)} sx={{ mt: 3 }}>Add connection</Button>
                </Stack>
              ) : !activeTab || !tabConnection ? (
                <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1.5, color: 'text.disabled' }}>
                  <DataObjectRounded sx={{ fontSize: 28 }} />
                  <Typography variant="body2">Open a query from a database or create a new tab.</Typography>
                  <Button size="small" variant="outlined" startIcon={<AddRounded />} onClick={addQueryFromExplorer}>New query</Button>
                </Stack>
              ) : (
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <Group orientation="vertical" id="query-panels" defaultLayout={queryLayout.defaultLayout} onLayoutChanged={queryLayout.onLayoutChanged} style={{ flex: 1, minHeight: 0 }}>
                    <Panel id="editor" defaultSize="54%" minSize={150}>
                      <SqlEditor
                        key={activeTab.id}
                        ref={editorRef}
                        connection={tabConnection}
                        provider={activeProvider}
                        database={activeTab.database}
                        databases={tabDatabases}
                        schema={editorSchema}
                        initialQuery={activeQuery}
                        running={activeTab.running}
                        onDatabaseChange={changeTabDatabase}
                        onQueryChange={(query) => handleQueryChange(activeTab.id, query)}
                        onRun={() => void runQuery()}
                      />
                    </Panel>
                    <Separator className="resize-handle" />
                    <Panel id="results" defaultSize="46%" minSize={120}>
                      <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
                        {tabs
                          .filter((tab) => tab.id === activeTab.id || tab.result !== null || tab.error !== null)
                          .map((tab) => (
                            <TabResultsPanel
                              key={tab.id}
                              tab={tab}
                              active={tab.id === activeTab.id}
                              onClearTab={clearTabResults}
                            />
                          ))}
                      </Box>
                    </Panel>
                  </Group>
                  <Stack component="footer" direction="row" sx={{ height: 25, flex: '0 0 auto', alignItems: 'center', gap: 1, px: 1.25, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main', boxShadow: '0 0 0 3px rgba(141,221,138,.08)' }} />
                    <Typography variant="caption" color="text.secondary">Connected</Typography>
                    <Typography variant="caption" color="text.disabled">{activeTab.database ?? tabConnection.name}</Typography>
                    <Box sx={{ flex: 1 }} />
                    <Typography variant="caption" color="text.disabled">{activeProvider?.label}</Typography>
                    <Typography variant="caption" color="text.disabled">UTF-8</Typography>
                  </Stack>
                </Box>
              )}
            </Box>
          </Panel>
        </Group>
      </Box>

      <ConnectionDialog
        open={connectionDialogOpen}
        providers={providers}
        busy={isConnecting}
        error={connectionError}
        onClose={() => setConnectionDialogOpen(false)}
        onOpenSqlite={() => void addSqlite('open')}
        onCreateSqlite={() => void addSqlite('create')}
        onConnect={(input) => void addServerConnection(input)}
      />
      <SettingsDialog
        open={settingsDialogOpen}
        settings={settings}
        onClose={() => setSettingsDialogOpen(false)}
        onSave={onSettingsChange}
      />
    </Box>
  )
}

export default App
