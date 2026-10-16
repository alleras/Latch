import { useCallback, useEffect, useRef, useState } from 'react'
import AddRounded from '@mui/icons-material/AddRounded'
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded'
import SettingsRounded from '@mui/icons-material/SettingsRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { ServerConnectionInput } from '../../shared/types'
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
    initialize: initializeWorkspace,
    openQuery,
    closeTabs,
    closeTabsForConnection,
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
    databases: explorerDatabases,
    schema: explorerSchema,
    initialize: initializeExplorer,
    selectConnection: selectExplorerConnection,
    selectDatabase: selectExplorerDatabase,
    selectAddedConnection,
    handleConnectionRemoved,
    refreshDatabases: refreshActiveDatabases,
    refreshSchema: refreshActiveSchema
  } = useDatabaseExplorer({
    connections,
    databasesByConnection,
    schemasByContext,
    loadDatabases,
    loadSchema
  })
  const tabConnection = connections.find((connection) => connection.id === activeTab?.connectionId) ?? null

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

  const addSqlite = useCallback(async (mode: 'open' | 'create'): Promise<void> => {
    const connection = await openSqlite(mode)
    if (!connection) return
    selectAddedConnection(connection.id)
    openQuery(connection.id)
    setConnectionDialogOpen(false)
  }, [openQuery, openSqlite, selectAddedConnection])

  const addServerConnection = useCallback(async (input: ServerConnectionInput): Promise<void> => {
    setIsConnecting(true)
    setConnectionError(null)
    try {
      const connection = await addServer(input)
      selectAddedConnection(connection.id)
      setConnectionDialogOpen(false)
    } catch (error) {
      setConnectionError(readableErrorMessage(error))
    } finally {
      setIsConnecting(false)
    }
  }, [addServer, selectAddedConnection])

  const removeConnection = useCallback(async (connectionId: string): Promise<void> => {
    const remaining = await removeManagedConnection(connectionId)
    evictConnection(connectionId)
    closeTabsForConnection(connectionId)
    handleConnectionRemoved(connectionId, remaining)
  }, [closeTabsForConnection, evictConnection, handleConnectionRemoved, removeManagedConnection])

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
              databases={explorerDatabases}
              loadingDatabases={Boolean(explorerConnection && loadingDatabaseIds.has(explorerConnection.id))}
              loadingSchema={Boolean(explorerConnection && loadingSchemaKeys.has(connectionDatabaseKey(explorerConnection.id, explorerDatabase)))}
              schema={explorerSchema}
              onAdd={openConnectionDialog}
              onSelectConnection={selectExplorerConnection}
              onRemoveConnection={removeConnection}
              onSelectDatabase={selectExplorerDatabase}
              onOpenQuery={openQuery}
              onRefreshDatabases={refreshActiveDatabases}
              onRefreshSchema={refreshActiveSchema}
            />
          </Panel>

          <Separator className="resize-handle" />

          <Panel id="workspace" minSize={480}>
            {connections.length === 0 ? (
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
    </Box>
  )
}

export default App
