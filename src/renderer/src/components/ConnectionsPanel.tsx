import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import AddRounded from '@mui/icons-material/AddRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import DataObjectRounded from '@mui/icons-material/DataObjectRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import StorageRounded from '@mui/icons-material/StorageRounded'
import { Box, CircularProgress, IconButton, ListItemButton, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography } from '@mui/material'
import { componentSizes } from '../theme'
import { connectionRows, indexConnections, visibleConnectionRows } from '../features/connections/connection-tree'
import { PanelFilterField, PanelFilterToggle, usePanelFilter } from './PanelFilter'
import { ProviderIcon, providerColor } from './ProviderIcon'
import type { SidebarProps } from './Sidebar'

const SIDEBAR_SIZE = componentSizes.sidebarPanel
type ConnectionsPanelProps = Omit<SidebarProps, 'schema' | 'loadingSchema' | 'onRefreshSchema'>

export const ConnectionsPanel = memo(function ConnectionsPanel({
  connections, providers, activeConnection, activeDatabase, databasesByConnection, loadingDatabaseIds,
  onAdd, onSelectConnection, onRemoveConnection, onExpandConnection, onSelectDatabase, onOpenQuery, onRefreshDatabases
}: ConnectionsPanelProps) {
  const filter = usePanelFilter()
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const [databaseMenu, setDatabaseMenu] = useState<{ connectionId: string; database: string; mouseX: number; mouseY: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportHeight, setViewportHeight] = useState(300)
  const [scrollTop, setScrollTop] = useState(0)
  const entries = useMemo(() => indexConnections(connections, providers, databasesByConnection), [connections, providers, databasesByConnection])
  const rows = useMemo(() => connectionRows(entries, expandedServers, filter.needle, loadingDatabaseIds, SIDEBAR_SIZE), [entries, expandedServers, filter.needle, loadingDatabaseIds])
  const lastRow = rows[rows.length - 1]
  const totalHeight = lastRow ? lastRow.top + lastRow.height : 0
  const visibleRows = visibleConnectionRows(rows, Math.min(scrollTop, Math.max(0, totalHeight - viewportHeight)), viewportHeight)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => setViewportHeight(viewport.clientHeight))
    observer.observe(viewport)
    setViewportHeight(viewport.clientHeight)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0
    setScrollTop(0)
  }, [filter.needle])
  useEffect(() => {
    if (!activeConnection || activeConnection.provider === 'sqlite') return
    setExpandedServers((current) => current.has(activeConnection.id) ? current : new Set(current).add(activeConnection.id))
  }, [activeConnection])

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

  return (
    <Box {...filter.panelProps} aria-label="Connections" sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none' }}>
      <Stack direction="row" sx={{ height: SIDEBAR_SIZE.headerHeight, alignItems: 'center', px: 1.25, flex: '0 0 auto' }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Connections</Typography>
        <PanelFilterToggle label="Connections" open={filter.open} onToggle={filter.toggle} />
        <Tooltip title="Add connection"><IconButton size="small" onClick={onAdd}><AddRounded sx={{ fontSize: SIDEBAR_SIZE.icon }} /></IconButton></Tooltip>
      </Stack>
      {filter.open && <PanelFilterField label="Filter connections / databases" inputRef={filter.inputRef} onFilterChange={filter.setNeedle} />}
      <Box ref={viewportRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} sx={{ px: 0.75, pb: 0.75, flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Box role="list" aria-label="Connections and databases" sx={{ height: totalHeight, position: 'relative' }}>
          {visibleRows.map((row) => {
            const { connection } = row.entry
            const active = connection.id === activeConnection?.id
            const expanded = row.expanded
            const canExpand = connection.provider !== 'sqlite'
            const color = providerColor[connection.provider]
            const loadingDatabases = loadingDatabaseIds.has(connection.id)
            return (
              <Box role="listitem" key={JSON.stringify([connection.id, row.kind, row.database])} sx={{ position: 'absolute', top: row.top, height: row.height, width: '100%' }}>
                {row.kind === 'connection' ? (
                  <ListItemButton
                    selected={active}
                    onClick={() => onSelectConnection(connection.id)}
                    sx={{
                      height: '100%',
                      minHeight: 0,
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
                      secondary={connection.provider === 'sqlite' ? row.entry.providerLabel : `${row.entry.providerLabel} · ${connection.host}`}
                      slotProps={{ primary: { variant: 'sidebarTitle', noWrap: true }, secondary: { variant: 'sidebarMeta', noWrap: true } }}
                    />
                    <IconButton className="remove-connection" size="small" onClick={(event) => { event.stopPropagation(); onRemoveConnection(connection.id) }}><CloseRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon }} /></IconButton>
                  </ListItemButton>
                ) : (
                  <Box sx={{ ml: 2.1, pl: 1, height: '100%', borderLeft: '1px solid', borderColor: 'divider' }}>
                    {row.kind === 'databases' ? (
                      <Stack direction="row" sx={{ height: '100%', alignItems: 'center', pl: 0.5 }}>
                        <Typography variant="sidebarMeta" color="text.disabled" sx={{ flex: 1 }}>Databases · {row.count}</Typography>
                        <Tooltip title="Refresh databases"><IconButton size="small" onClick={() => onRefreshDatabases(connection.id)}>{loadingDatabases ? <CircularProgress size={SIDEBAR_SIZE.detailIcon} /> : <RefreshRounded sx={{ fontSize: SIDEBAR_SIZE.detailIcon }} />}</IconButton></Tooltip>
                      </Stack>
                    ) : row.kind === 'database' ? (
                      <ListItemButton selected={active && row.database === activeDatabase} onClick={() => onSelectDatabase(connection.id, row.database!)} onContextMenu={(event) => openDatabaseMenu(event, connection.id, row.database!)} sx={{ height: '100%', minHeight: 0, px: 0.75, py: 0, borderRadius: 0.75, '&.Mui-selected': { bgcolor: 'action.selected' } }}>
                        <StorageRounded sx={{ mr: 0.75, fontSize: SIDEBAR_SIZE.detailIcon, color: active && row.database === activeDatabase ? 'primary.main' : 'text.disabled' }} />
                        <ListItemText primary={row.database} slotProps={{ primary: { variant: 'sidebarItem', noWrap: true } }} />
                      </ListItemButton>
                    ) : <Typography variant="sidebarMeta" color="text.disabled" sx={{ display: 'block', px: 1, py: 0.5 }}>No visible databases</Typography>}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
        {rows.length === 0 && <Typography variant="sidebarMeta" color="text.disabled" sx={{ display: 'block', px: 1, py: 1 }}>{connections.length === 0 ? 'No connections yet.' : 'No matching connections or databases.'}</Typography>}
      </Box>
      <Menu open={Boolean(databaseMenu)} onClose={() => setDatabaseMenu(null)} anchorReference="anchorPosition" anchorPosition={databaseMenu ? { top: databaseMenu.mouseY, left: databaseMenu.mouseX } : undefined} slotProps={{ list: { dense: true }, paper: { sx: { minWidth: 170 } } }}>
        <MenuItem onClick={() => {
          if (databaseMenu) onOpenQuery(databaseMenu.connectionId, databaseMenu.database)
          setDatabaseMenu(null)
        }}>
          <DataObjectRounded sx={{ mr: 1, fontSize: 16, color: 'text.secondary' }} />New query
        </MenuItem>
      </Menu>
    </Box>
  )
})
