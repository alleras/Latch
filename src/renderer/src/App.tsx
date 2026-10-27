import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AddRounded from '@mui/icons-material/AddRounded'
import SettingsRounded from '@mui/icons-material/SettingsRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { ServerConnectionInput } from '../../shared/types'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ConnectionDialog } from './components/ConnectionDialog'
import { LatchMark } from './components/LatchMark'
import { NoticeSnackbar } from './components/NoticeSnackbar'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
import { readableErrorMessage } from './errors'
import { preferredDatabase, useDatabaseCatalog } from './features/database-catalog/useDatabaseCatalog'
import { useConnectionManager } from './features/connections/useConnectionManager'
import { useDatabaseExplorer } from './features/database-explorer/useDatabaseExplorer'
import { QueryWorkspace } from './features/query-workspace/QueryWorkspace'
import { useQueryWorkspace, type ConnectionTarget } from './features/query-workspace/useQueryWorkspace'
import { AppTitleBar } from './features/window-chrome/AppTitleBar'
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
  const explorerTarget = useMemo((): ConnectionTarget | null => explorerConnection
    ? { connectionId: explorerConnection.id, database: explorerConnection.provider === 'sqlite' ? undefined : explorerDatabase }
    : null, [explorerConnection, explorerDatabase])
  const {
    tabs,
    activeTabId,
    activeTab,
    editorRef,
    notice,
    dismissNotice,
    closePrompt,
    answerClosePrompt,
    confirmation,
    answerConfirmation,
    initialize: initializeWorkspace,
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
  } = useQueryWorkspace({ onSchemaChanged: handleSchemaChanged, explorerTarget })

  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const initializedRef = useRef(false)
  const applicationLayout = useDefaultLayout({ id: 'application-panels', storage: localStorage })
  const tabConnection = connections.find((connection) => connection.id === activeTab?.connectionId) ?? null

  useEffect(() => {
    if (!connectionsReady || initializedRef.current) return
    initializedRef.current = true
    const restoredWorkspaceContext = initializeWorkspace(connections)
    initializeExplorer(connections, restoredWorkspaceContext)
    loadRestoredFiles()
  }, [connections, connectionsReady, initializeExplorer, initializeWorkspace, loadRestoredFiles])

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
    if (!explorerTarget) {
      openConnectionDialog()
      return
    }
    openQuery(explorerTarget.connectionId, explorerTarget.database)
  }, [explorerTarget, openConnectionDialog, openQuery])

  // File menu items belong to the query workspace; New Query may open the connection dialog, so it stays here.
  useEffect(() => window.latch.onMenuCommand((command) => {
    if (command === 'new-query') addQueryFromExplorer()
  }), [addQueryFromExplorer])

  const addSqlite = useCallback(async (mode: 'open' | 'create'): Promise<void> => {
    const connection = await openSqlite(mode)
    if (!connection) return
    selectAddedConnection(connection.id)
    // A connectionless tab waiting for a target takes the new database instead of a fresh query tab.
    if (!adoptConnection(connection.id)) openQuery(connection.id)
    setConnectionDialogOpen(false)
  }, [adoptConnection, openQuery, openSqlite, selectAddedConnection])

  const addServerConnection = useCallback(async (input: ServerConnectionInput): Promise<void> => {
    setIsConnecting(true)
    setConnectionError(null)
    try {
      const connection = await addServer(input)
      selectAddedConnection(connection.id)
      adoptConnection(connection.id, connection.provider === 'sqlite' ? undefined : connection.initialDatabase)
      setConnectionDialogOpen(false)
    } catch (error) {
      setConnectionError(readableErrorMessage(error))
    } finally {
      setIsConnecting(false)
    }
  }, [addServer, adoptConnection, selectAddedConnection])

  const removeConnection = useCallback(async (connectionId: string): Promise<void> => {
    const remaining = await removeManagedConnection(connectionId)
    evictConnection(connectionId)
    releaseConnection(connectionId)
    handleConnectionRemoved(connectionId, remaining)
  }, [evictConnection, handleConnectionRemoved, releaseConnection, removeManagedConnection])

  const selectConnectionFromSidebar = useCallback((connectionId: string): void => {
    selectExplorerConnection(connectionId)
    adoptConnection(connectionId)
  }, [adoptConnection, selectExplorerConnection])

  const selectDatabaseFromSidebar = useCallback((connectionId: string, database: string): void => {
    selectExplorerDatabase(connectionId, database)
    adoptConnection(connectionId, database)
  }, [adoptConnection, selectExplorerDatabase])

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
      <AppTitleBar connectionName={displayConnection?.name} />

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
                onCloseTabs={requestCloseTabs}
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
      <UnsavedChangesDialog
        open={Boolean(closePrompt)}
        fileName={closePrompt?.title}
        saving={closePrompt?.saving ?? false}
        onSave={() => answerClosePrompt('save')}
        onDiscard={() => answerClosePrompt('discard')}
        onCancel={() => answerClosePrompt('cancel')}
      />
      <ConfirmDialog
        request={confirmation}
        onConfirm={() => answerConfirmation(true)}
        onCancel={() => answerConfirmation(false)}
      />
      <NoticeSnackbar notice={notice} onDismiss={dismissNotice} />
    </Box>
  )
}

export default App
