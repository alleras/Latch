import { memo, useEffect, useState, type MouseEvent } from 'react'
import AddRounded from '@mui/icons-material/AddRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DataObjectRounded from '@mui/icons-material/DataObjectRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import {
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography
} from '@mui/material'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { Connection, DatabaseObject, ProviderDefinition } from '../../../shared/types'
import { DatabaseExplorer } from './DatabaseExplorer'
import { ProviderIcon, providerColor } from './ProviderIcon'

interface SidebarProps {
  connections: Connection[]
  providers: ProviderDefinition[]
  activeConnection: Connection | null
  activeDatabase?: string
  databases: string[]
  loadingDatabases: boolean
  loadingSchema: boolean
  schema: DatabaseObject[]
  onAdd: () => void
  onSelectConnection: (id: string) => void
  onRemoveConnection: (id: string) => void
  onSelectDatabase: (database: string) => void
  onOpenQuery: (connectionId: string, database?: string) => void
  onRefreshDatabases: () => void
  onRefreshSchema: () => void
}

export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const sidebarLayout = useDefaultLayout({ id: 'sidebar-panels', storage: localStorage })
  const {
    connections, providers, activeConnection, activeDatabase, databases, loadingDatabases, loadingSchema, schema,
    onAdd, onSelectConnection, onRemoveConnection, onSelectDatabase,
    onOpenQuery, onRefreshDatabases, onRefreshSchema
  } = props
  const [databaseMenu, setDatabaseMenu] = useState<{
    connectionId: string
    database: string
    mouseX: number
    mouseY: number
  } | null>(null)

  useEffect(() => {
    if (activeConnection?.provider === 'sqlite' || !activeConnection) return
    setExpandedServers((current) => current.has(activeConnection.id) ? current : new Set(current).add(activeConnection.id))
  }, [activeConnection])

  const provider = (connection: Connection) => providers.find((item) => item.id === connection.provider)
  const toggle = (values: Set<string>, value: string, setter: (next: Set<string>) => void): void => {
    const next = new Set(values)
    next.has(value) ? next.delete(value) : next.add(value)
    setter(next)
  }

  const openDatabaseMenu = (event: MouseEvent<HTMLElement>, connectionId: string, database: string): void => {
    event.preventDefault()
    setDatabaseMenu({ connectionId, database, mouseX: event.clientX + 2, mouseY: event.clientY - 6 })
  }

  const openQueryFromDatabase = (): void => {
    if (!databaseMenu) return
    onOpenQuery(databaseMenu.connectionId, databaseMenu.database)
    setDatabaseMenu(null)
  }

  return (
    <Box component="aside" sx={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, borderRight: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Group orientation="vertical" id="sidebar-panels" defaultLayout={sidebarLayout.defaultLayout} onLayoutChanged={sidebarLayout.onLayoutChanged} style={{ height: '100%' }}>
        <Panel id="connections" defaultSize="42%" minSize={96}>
          <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Stack direction="row" sx={{ height: 34, alignItems: 'center', px: 1.25, flex: '0 0 auto' }}>
              <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Connections</Typography>
              <Tooltip title="Add connection"><IconButton size="small" onClick={onAdd}><AddRounded sx={{ fontSize: 17 }} /></IconButton></Tooltip>
            </Stack>

            <List disablePadding sx={{ px: 0.75, pb: 0.75, flex: 1, minHeight: 0, overflow: 'auto' }}>
              {connections.map((connection) => {
                const active = connection.id === activeConnection?.id
                const expanded = expandedServers.has(connection.id)
                const canExpand = connection.provider !== 'sqlite'
                const color = providerColor[connection.provider]
                return (
                  <Box key={connection.id}>
                    <ListItemButton
                      selected={active}
                      onClick={() => onSelectConnection(connection.id)}
                      sx={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        minHeight: 40,
                        px: 0.75,
                        py: 0.25,
                        borderRadius: 1,
                        bgcolor: 'background.paper',
                        '&.Mui-selected': { bgcolor: 'var(--latch-connection-selected)' },
                        '&.Mui-selected:hover': { bgcolor: 'var(--latch-connection-selected-hover)' },
                        '& .remove-connection': { opacity: 0 },
                        '&:hover .remove-connection': { opacity: 1 }
                      }}
                    >
                      {canExpand ? (
                        <IconButton
                          size="small"
                          aria-label={expanded ? 'Collapse server' : 'Expand server'}
                          onClick={(event) => { event.stopPropagation(); if (!active) onSelectConnection(connection.id); toggle(expandedServers, connection.id, setExpandedServers) }}
                          sx={{ width: 22, height: 22, mr: 0.25 }}
                        >
                          {expanded ? <ExpandMoreRounded sx={{ fontSize: 15 }} /> : <ChevronRightRounded sx={{ fontSize: 15 }} />}
                        </IconButton>
                      ) : <Box sx={{ width: 22, mr: 0.25 }} />}
                      <Box sx={{ width: 26, height: 26, mr: 0.75, display: 'grid', placeItems: 'center', borderRadius: 1, color, bgcolor: `${color}10` }}>
                        <ProviderIcon provider={connection.provider} sx={{ fontSize: 15 }} />
                      </Box>
                      <ListItemText
                        primary={connection.name}
                        secondary={connection.provider === 'sqlite' ? provider(connection)?.label : `${provider(connection)?.label} · ${connection.host}`}
                        slotProps={{ primary: { noWrap: true, sx: { fontSize: 11.5, fontWeight: 600, lineHeight: 1.25 } }, secondary: { noWrap: true, sx: { fontSize: 9.5, lineHeight: 1.25 } } }}
                      />
                      <IconButton className="remove-connection" size="small" onClick={(event) => { event.stopPropagation(); onRemoveConnection(connection.id) }}><CloseRounded sx={{ fontSize: 13 }} /></IconButton>
                    </ListItemButton>

                    {active && expanded && canExpand && (
                      <Box sx={{ ml: 2.1, pl: 1, borderLeft: '1px solid', borderColor: 'divider' }}>
                        <Stack direction="row" sx={{ height: 24, alignItems: 'center', pl: 0.5 }}>
                          <Typography variant="overline" color="text.disabled" sx={{ flex: 1, fontSize: 8 }}>Databases · {databases.length}</Typography>
                          <Tooltip title="Refresh databases"><IconButton size="small" onClick={onRefreshDatabases}>{loadingDatabases ? <CircularProgress size={11} /> : <RefreshRounded sx={{ fontSize: 12 }} />}</IconButton></Tooltip>
                        </Stack>
                        {databases.map((database) => (
                          <ListItemButton key={database} selected={database === activeDatabase} onClick={() => onSelectDatabase(database)} onContextMenu={(event) => openDatabaseMenu(event, connection.id, database)} sx={{ minHeight: 24, px: 0.75, py: 0, borderRadius: 0.75, '&.Mui-selected': { bgcolor: 'action.selected' } }}>
                            <StorageRounded sx={{ mr: 0.75, fontSize: 12, color: database === activeDatabase ? 'primary.main' : 'text.disabled' }} />
                            <ListItemText primary={database} slotProps={{ primary: { noWrap: true, sx: { fontSize: 10.5, lineHeight: 1.2 } } }} />
                          </ListItemButton>
                        ))}
                        {!loadingDatabases && databases.length === 0 && <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 1, py: 0.5 }}>No visible databases</Typography>}
                      </Box>
                    )}
                  </Box>
                )
              })}
              {connections.length === 0 && <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 1, py: 1 }}>No connections yet.</Typography>}
            </List>
          </Box>
        </Panel>

        <Separator className="resize-handle" />

        <Panel id="schema" defaultSize="58%" minSize={110}>
          {activeConnection ? (
            <DatabaseExplorer
              connectionId={activeConnection.id}
              provider={activeConnection.provider}
              database={activeDatabase}
              loading={loadingSchema}
              objects={schema}
              onRefresh={onRefreshSchema}
            />
          ) : (
            <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <Stack direction="row" sx={{ height: 34, alignItems: 'center', px: 1.25 }}>
                <Typography variant="overline" color="text.secondary">Database Explorer</Typography>
              </Stack>
              <Typography variant="caption" color="text.disabled" sx={{ px: 1.5, py: 0.75 }}>Select a connection to browse database objects.</Typography>
            </Box>
          )}
        </Panel>
      </Group>
      <Menu
        open={Boolean(databaseMenu)}
        onClose={() => setDatabaseMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={databaseMenu ? { top: databaseMenu.mouseY, left: databaseMenu.mouseX } : undefined}
        slotProps={{ list: { dense: true }, paper: { sx: { minWidth: 170 } } }}
      >
        <MenuItem onClick={openQueryFromDatabase}>
          <DataObjectRounded sx={{ mr: 1, fontSize: 16, color: 'text.secondary' }} />
          New query
        </MenuItem>
      </Menu>
    </Box>
  )
})
