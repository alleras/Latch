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
import { componentSizes } from '../theme'
import { DatabaseExplorer } from './DatabaseExplorer'
import { ProviderIcon, providerColor } from './ProviderIcon'

const SIDEBAR_SIZE = componentSizes.sidebarPanel

interface SidebarProps {
  connections: Connection[]
  providers: ProviderDefinition[]
  activeConnection: Connection | null
  activeDatabase?: string
  databasesByConnection: Record<string, string[]>
  loadingDatabaseIds: Set<string>
  loadingSchema: boolean
  schema: DatabaseObject[]
  onAdd: () => void
  onSelectConnection: (id: string) => void
  onRemoveConnection: (id: string) => void
  onExpandConnection: (id: string) => void
  onSelectDatabase: (connectionId: string, database: string) => void
  onOpenQuery: (connectionId: string, database?: string) => void
  onRefreshDatabases: (connectionId: string) => void
  onRefreshSchema: () => void
}

export const Sidebar = memo(function Sidebar(props: SidebarProps) {
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const sidebarLayout = useDefaultLayout({ id: 'sidebar-panels', storage: localStorage })
  const {
    connections, providers, activeConnection, activeDatabase, databasesByConnection, loadingDatabaseIds, loadingSchema, schema,
    onAdd, onSelectConnection, onRemoveConnection, onExpandConnection, onSelectDatabase,
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
  const toggleServer = (connectionId: string, expanded: boolean): void => {
    setExpandedServers((current) => {
      const next = new Set(current)
      expanded ? next.delete(connectionId) : next.add(connectionId)
      return next
    })
    if (!expanded) onExpandConnection(connectionId)
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
            <Stack direction="row" sx={{ height: SIDEBAR_SIZE.headerHeight, alignItems: 'center', px: 1.25, flex: '0 0 auto' }}>
              <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Connections</Typography>
              <Tooltip title="Add connection"><IconButton size="small" onClick={onAdd}><AddRounded sx={{ fontSize: SIDEBAR_SIZE.icon }} /></IconButton></Tooltip>
            </Stack>

            <List disablePadding sx={{ px: 0.75, pb: 0.75, flex: 1, minHeight: 0, overflow: 'auto' }}>
              {connections.map((connection) => {
                const active = connection.id === activeConnection?.id
                const expanded = expandedServers.has(connection.id)
                const canExpand = connection.provider !== 'sqlite'
                const color = providerColor[connection.provider]
                const connectionDatabases = databasesByConnection[connection.id] ?? []
                const loadingDatabases = loadingDatabaseIds.has(connection.id)
                return (
                  <Box key={connection.id}>
                    <ListItemButton
                      selected={active}
                      onClick={() => onSelectConnection(connection.id)}
                      sx={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        minHeight: SIDEBAR_SIZE.connectionRowHeight,
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
                          onClick={(event) => { event.stopPropagation(); toggleServer(connection.id, expanded) }}
                          sx={{ width: 22, height: 22, mr: 0.25 }}
                        >
                          {expanded ? <ExpandMoreRounded sx={{ fontSize: SIDEBAR_SIZE.chevron }} /> : <ChevronRightRounded sx={{ fontSize: SIDEBAR_SIZE.chevron }} />}
                        </IconButton>
                      ) : <Box sx={{ width: 22, mr: 0.25 }} />}
                      <Box sx={{ width: 26, height: 26, mr: 0.75, display: 'grid', placeItems: 'center', borderRadius: 1, color, bgcolor: `${color}10` }}>
                        <ProviderIcon provider={connection.provider} sx={{ fontSize: SIDEBAR_SIZE.icon }} />
                      </Box>
                      <ListItemText
                        primary={connection.name}
                        secondary={connection.provider === 'sqlite' ? provider(connection)?.label : `${provider(connection)?.label} · ${connection.host}`}
                        slotProps={{ primary: { variant: 'sidebarTitle', noWrap: true }, secondary: { variant: 'sidebarMeta', noWrap: true } }}
                      />
                      <IconButton className="remove-connection" size="small" onClick={(event) => { event.stopPropagation(); onRemoveConnection(connection.id) }}><CloseRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon }} /></IconButton>
                    </ListItemButton>

                    {expanded && canExpand && (
                      <Box sx={{ ml: 2.1, pl: 1, borderLeft: '1px solid', borderColor: 'divider' }}>
                        <Stack direction="row" sx={{ height: SIDEBAR_SIZE.detailRowHeight, alignItems: 'center', pl: 0.5 }}>
                          <Typography variant="sidebarMeta" color="text.disabled" sx={{ flex: 1 }}>Databases · {connectionDatabases.length}</Typography>
                          <Tooltip title="Refresh databases"><IconButton size="small" onClick={() => onRefreshDatabases(connection.id)}>{loadingDatabases ? <CircularProgress size={SIDEBAR_SIZE.detailIcon} /> : <RefreshRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon }} />}</IconButton></Tooltip>
                        </Stack>
                        {connectionDatabases.map((database) => (
                          <ListItemButton key={database} selected={active && database === activeDatabase} onClick={() => onSelectDatabase(connection.id, database)} onContextMenu={(event) => openDatabaseMenu(event, connection.id, database)} sx={{ minHeight: SIDEBAR_SIZE.rowHeight, px: 0.75, py: 0, borderRadius: 0.75, '&.Mui-selected': { bgcolor: 'action.selected' } }}>
                            <StorageRounded sx={{ mr: 0.75, fontSize: SIDEBAR_SIZE.detailIcon, color: active && database === activeDatabase ? 'primary.main' : 'text.disabled' }} />
                            <ListItemText primary={database} slotProps={{ primary: { variant: 'sidebarItem', noWrap: true } }} />
                          </ListItemButton>
                        ))}
                        {!loadingDatabases && connectionDatabases.length === 0 && <Typography variant="sidebarMeta" color="text.disabled" sx={{ display: 'block', px: 1, py: 0.5 }}>No visible databases</Typography>}
                      </Box>
                    )}
                  </Box>
                )
              })}
              {connections.length === 0 && <Typography variant="sidebarMeta" color="text.disabled" sx={{ display: 'block', px: 1, py: 1 }}>No connections yet.</Typography>}
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
              <Stack direction="row" sx={{ height: SIDEBAR_SIZE.headerHeight, alignItems: 'center', px: 1.25 }}>
                <Typography variant="overline" color="text.secondary">Database Explorer</Typography>
              </Stack>
              <Typography variant="sidebarMeta" color="text.disabled" sx={{ px: 1.5, py: 0.75 }}>Select a connection to browse database objects.</Typography>
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
