import { useCallback, useEffect, useRef, useState } from 'react'
import AddRounded from '@mui/icons-material/AddRounded'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import SettingsRounded from '@mui/icons-material/SettingsRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import { Box, Button, IconButton, Snackbar, Stack, Tooltip, Typography } from '@mui/material'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { MenuCommand, ServerConnectionInput } from '../../shared/types'
import { ConnectionDialog } from './components/ConnectionDialog'
import { LatchMark } from './components/LatchMark'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { readableErrorMessage } from './errors'
import { preferredDatabase, useDatabaseCatalog } from './features/database-catalog/useDatabaseCatalog'
import { useConnectionManager } from './features/connections/useConnectionManager'
import { useDatabaseExplorer } from './features/database-explorer/useDatabaseExplorer'
import { QueryWorkspace } from './features/query-workspace/QueryWorkspace'
import { useQueryWorkspace } from './features/query-workspace/useQueryWorkspace'
import { connectionDatabaseKey } from './query-tabs'
import type { AppSettings } from './settings'

interface AppProps {
  settings: AppSettings
  onSettingsChange: (settings: AppSettings) => void
}

function App({ settings, onSettingsChange }: AppProps) {
  const {
    providers,
    connections,
    ready: connectionsReady,
    openSqlite,
    addServer,
    remove: removeManagedConnection
  } = useConnectionManager()
  const {
    databasesByConnection,
    schemasByContext,
    loadingDatabaseIds,
    loadingSchemaKeys,
    loadDatabases,
    loadSchema,
    evictConnection
  } = useDatabaseCatalog()
  const handleSchemaChanged = useCallback((connectionId: string, database?: string): void => {
    void loadSchema(connectionId, database, true).catch(console.error)
  }, [loadSchema])
  const {
    tabs,
    activeTabId,
    activeTab,
    editorRef,
    notice,
    showNotice,
    dismissNotice,
    initialize: initializeWorkspace,
    openQuery,
    openFiles,
    saveTab,
    saveTabAs,
    closeTabs,
    attachConnection,
    releaseConnection,
    selectTab,
    updateDraft,
    queryForTab,
    changeDatabase,
    reconcileDatabases,
    clearResults,
    runQuery
  } = useQueryWorkspace({ onSchemaChanged: handleSchemaChanged })

  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const initializedRef = useRef(false)
  const applicationLayout = useDefaultLayout({ id: 'application-panels', storage: localStorage })
  const {
    database: explorerDatabase,
    connection: explorerConnection,
    schema: explorerSchema,
    initialize: initializeExplorer,
    selectConnection: selectExplorerConnection,
    selectDatabase: selectExplorerDatabase,
    selectAddedConnection,
    handleConnectionRemoved,
    refreshSchema: refreshActiveSchema
  } = useDatabaseExplorer({
    connections,
    databasesByConnection,
    schemasByContext,
    loadDatabases,
    loadSchema
  })
  const tabConnection = connections.find((connection) => connection.id === activeTab?.connectionId) ?? null
  // Async handlers and activation effects read the latest values through refs, never stale closures.
  const activeTabRef = useRef(activeTab)
  const explorerRef = useRef({ connection: explorerConnection, database: explorerDatabase })
  activeTabRef.current = activeTab
  explorerRef.current = { connection: explorerConnection, database: explorerDatabase }

  /**
   * A tab with no connection adopts one only on a user action: activation, a sidebar pick,
   * or adding a connection. Returns true when the active tab took the connection.
   */
  const adoptIntoActiveTab = useCallback((connectionId: string, database?: string): boolean => {
    const tab = activeTabRef.current
    if (!tab || tab.connectionId !== null) return false
    attachConnection(tab.id, connectionId, database)
    return true
  }, [attachConnection])

  useEffect(() => {
    // Activation trigger: keyed on the active tab only, so explorer changes alone never retarget a tab.
    const explorer = explorerRef.current
    if (!explorer.connection) return
    adoptIntoActiveTab(explorer.connection.id, explorer.connection.provider === 'sqlite' ? undefined : explorer.database)
  }, [activeTabId, adoptIntoActiveTab])

  useEffect(() => {
    if (!connectionsReady || initializedRef.current) return
    initializedRef.current = true
    const restoredWorkspaceContext = initializeWorkspace(connections)
    initializeExplorer(connections, restoredWorkspaceContext)
  }, [connections, connectionsReady, initializeExplorer, initializeWorkspace])

  useEffect(() => {
    if (!activeTab || !tabConnection) return
    if (tabConnection.provider === 'sqlite') {
      void loadSchema(tabConnection.id).catch(console.error)
      return
    }
    void loadDatabases(tabConnection).then((databases) => {
      const fallback = preferredDatabase(tabConnection, databases)
      reconcileDatabases(tabConnection, databases, fallback)
      if (activeTab.database && databases.includes(activeTab.database)) {
        void loadSchema(tabConnection.id, activeTab.database).catch(console.error)
      } else if (fallback) {
        void loadSchema(tabConnection.id, fallback).catch(console.error)
      }
    }).catch(console.error)
  }, [activeTab?.connectionId, activeTab?.database, loadDatabases, loadSchema, reconcileDatabases, tabConnection])

  const openConnectionDialog = useCallback((): void => {
    setConnectionError(null)
    setConnectionDialogOpen(true)
  }, [])

  const addQueryFromExplorer = useCallback((): void => {
    if (!explorerConnection) {
      openConnectionDialog()
      return
    }
    openQuery(explorerConnection.id, explorerConnection.provider === 'sqlite' ? undefined : explorerDatabase)
  }, [explorerConnection, explorerDatabase, openConnectionDialog, openQuery])

  const openFilesFromDialog = useCallback(async (): Promise<void> => {
    try {
      const files = await window.latch.openSqlFiles()
      if (files.length === 0) return
      // New file tabs target whatever the explorer shows now, exactly like New Query.
      const explorer = explorerRef.current
      openFiles(files, explorer.connection?.id ?? null, explorer.connection?.provider === 'sqlite' ? undefined : explorer.database)
    } catch (error) {
      showNotice(readableErrorMessage(error))
    }
  }, [openFiles, showNotice])

  const handleMenuCommand = useCallback((command: MenuCommand): void => {
    switch (command) {
      case 'new-query':
        addQueryFromExplorer()
        break
      case 'open-file':
        void openFilesFromDialog()
        break
      case 'save':
        if (activeTabRef.current) void saveTab(activeTabRef.current.id)
        break
      case 'save-as':
        if (activeTabRef.current) void saveTabAs(activeTabRef.current.id)
        break
    }
  }, [addQueryFromExplorer, openFilesFromDialog, saveTab, saveTabAs])

  useEffect(() => window.latch.onMenuCommand(handleMenuCommand), [handleMenuCommand])

  const addSqlite = useCallback(async (mode: 'open' | 'create'): Promise<void> => {
    const connection = await openSqlite(mode)
    if (!connection) return
    selectAddedConnection(connection.id)
    // A connectionless tab waiting for a target takes the new database instead of a fresh query tab.
    if (!adoptIntoActiveTab(connection.id)) openQuery(connection.id)
    setConnectionDialogOpen(false)
  }, [adoptIntoActiveTab, openQuery, openSqlite, selectAddedConnection])

  const addServerConnection = useCallback(async (input: ServerConnectionInput): Promise<void> => {
    setIsConnecting(true)
    setConnectionError(null)
    try {
      const connection = await addServer(input)
      selectAddedConnection(connection.id)
      adoptIntoActiveTab(connection.id, connection.provider === 'sqlite' ? undefined : connection.initialDatabase)
      setConnectionDialogOpen(false)
    } catch (error) {
      setConnectionError(readableErrorMessage(error))
    } finally {
      setIsConnecting(false)
    }
  }, [addServer, adoptIntoActiveTab, selectAddedConnection])

  const removeConnection = useCallback(async (connectionId: string): Promise<void> => {
    const remaining = await removeManagedConnection(connectionId)
    evictConnection(connectionId)
    releaseConnection(connectionId)
    handleConnectionRemoved(connectionId, remaining)
  }, [evictConnection, handleConnectionRemoved, releaseConnection, removeManagedConnection])

  const selectConnectionFromSidebar = useCallback((connectionId: string): void => {
    selectExplorerConnection(connectionId)
    adoptIntoActiveTab(connectionId)
  }, [adoptIntoActiveTab, selectExplorerConnection])

  const selectDatabaseFromSidebar = useCallback((connectionId: string, database: string): void => {
    selectExplorerDatabase(connectionId, database)
    adoptIntoActiveTab(connectionId, database)
  }, [adoptIntoActiveTab, selectExplorerDatabase])

  const expandConnection = useCallback((connectionId: string): void => {
    const connection = connections.find((candidate) => candidate.id === connectionId)
    if (!connection || connection.provider === 'sqlite') return
    void loadDatabases(connection).catch(console.error)
  }, [connections, loadDatabases])

  const refreshConnectionDatabases = useCallback((connectionId: string): void => {
    const connection = connections.find((candidate) => candidate.id === connectionId)
    if (!connection || connection.provider === 'sqlite') return
    void loadDatabases(connection, true).catch(console.error)
  }, [connections, loadDatabases])

  const displayConnection = tabConnection ?? explorerConnection

  return (
    <Box sx={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr)', gridTemplateRows: '46px minmax(0, 1fr)', bgcolor: 'background.default' }}>
      <Stack component="header" direction="row" sx={{ gridColumn: '1 / -1', alignItems: 'center', px: 1.25, pl: 9.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'var(--latch-shell)', WebkitAppRegion: 'drag', userSelect: 'none' }}>
        <Box sx={{ mr: 1 }}><LatchMark /></Box>
        <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: '.15em' }}>LATCH</Typography>
        <Box sx={{ height: 16, mx: 1.25, borderLeft: '1px solid', borderColor: 'divider' }} />
        <Typography variant="caption" color="text.secondary">{displayConnection?.name ?? 'SQL workspace'}</Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" sx={{ WebkitAppRegion: 'no-drag' }}><MoreHorizRounded fontSize="small" /></IconButton>
      </Stack>

      <Stack component="nav" sx={{ gridColumn: 1, gridRow: 2, alignItems: 'center', py: 1, borderRight: '1px solid', borderColor: 'divider', bgcolor: 'var(--latch-shell)' }}>
        <Tooltip title="Data sources" placement="right"><IconButton color="primary" sx={{ bgcolor: 'rgba(201,245,95,.08)' }}><StorageRounded fontSize="small" /></IconButton></Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Settings" placement="right"><IconButton aria-label="Open settings" onClick={() => setSettingsDialogOpen(true)}><SettingsRounded fontSize="small" /></IconButton></Tooltip>
      </Stack>

      <Box sx={{ gridColumn: 2, gridRow: 2, minWidth: 0, minHeight: 0 }}>
        <Group orientation="horizontal" id="application-panels" defaultLayout={applicationLayout.defaultLayout} onLayoutChanged={applicationLayout.onLayoutChanged} style={{ height: '100%' }}>
          <Panel id="sidebar" defaultSize={272} minSize={210} maxSize="42%">
            <Sidebar
              connections={connections}
              providers={providers}
              activeConnection={explorerConnection}
              activeDatabase={explorerDatabase}
              databasesByConnection={databasesByConnection}
              loadingDatabaseIds={loadingDatabaseIds}
              loadingSchema={Boolean(explorerConnection && loadingSchemaKeys.has(connectionDatabaseKey(explorerConnection.id, explorerDatabase)))}
              schema={explorerSchema}
              onAdd={openConnectionDialog}
              onSelectConnection={selectConnectionFromSidebar}
              onRemoveConnection={removeConnection}
              onExpandConnection={expandConnection}
              onSelectDatabase={selectDatabaseFromSidebar}
              onOpenQuery={openQuery}
              onRefreshDatabases={refreshConnectionDatabases}
              onRefreshSchema={refreshActiveSchema}
            />
          </Panel>

          <Separator className="resize-handle" />

          <Panel id="workspace" minSize={480}>
            {connections.length === 0 && tabs.length === 0 ? (
              <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 44%, rgba(201,245,95,.055), transparent 34%)' }}>
                <Box sx={{ filter: 'drop-shadow(0 24px 40px rgba(0,0,0,.45))' }}><LatchMark size={62} /></Box>
                <Typography variant="overline" color="primary.main" sx={{ mt: 3 }}>Your SQL workbench</Typography>
                <Typography variant="h2" align="center" sx={{ mt: 0.5, fontSize: { xs: 38, lg: 54 }, fontWeight: 500, lineHeight: 1, letterSpacing: '-.045em' }}>Every database.<br /><Box component="span" sx={{ color: 'primary.main', fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 400 }}>One close connection.</Box></Typography>
                <Typography variant="body2" align="center" color="text.secondary" sx={{ mt: 2, maxWidth: 430, lineHeight: 1.7 }}>Explore database objects and run queries across PostgreSQL, MySQL, SQL Server, Azure SQL, and SQLite.</Typography>
                <Button variant="contained" size="large" startIcon={<AddRounded />} onClick={openConnectionDialog} sx={{ mt: 3 }}>Add connection</Button>
              </Stack>
            ) : (
              <QueryWorkspace
                tabs={tabs}
                activeTabId={activeTabId}
                editorRef={editorRef}
                connections={connections}
                providers={providers}
                databasesByConnection={databasesByConnection}
                schemasByContext={schemasByContext}
                onSelectTab={selectTab}
                onCloseTabs={closeTabs}
                onAddTab={addQueryFromExplorer}
                onDatabaseChange={changeDatabase}
                onQueryChange={updateDraft}
                queryForTab={queryForTab}
                onRunQuery={runQuery}
                onClearResults={clearResults}
              />
            )}
          </Panel>
        </Group>
      </Box>

      <ConnectionDialog
        open={connectionDialogOpen}
        providers={providers}
        busy={isConnecting}
        error={connectionError}
        onClose={() => setConnectionDialogOpen(false)}
        onOpenSqlite={() => { void addSqlite('open') }}
        onCreateSqlite={() => { void addSqlite('create') }}
        onConnect={(input) => { void addServerConnection(input) }}
      />
      <SettingsDialog
        open={settingsDialogOpen}
        settings={settings}
        onClose={() => setSettingsDialogOpen(false)}
        onSave={onSettingsChange}
      />
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={6000}
        onClose={dismissNotice}
        message={notice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  )
}

export default App
