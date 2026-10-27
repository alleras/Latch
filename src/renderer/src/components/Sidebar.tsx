import { memo } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { Connection, DatabaseObject, ProviderDefinition } from '../../../shared/types'
import { componentSizes } from '../theme'
import { DatabaseExplorer } from './DatabaseExplorer'
import { ConnectionsPanel } from './ConnectionsPanel'

const SIDEBAR_SIZE = componentSizes.sidebarPanel

export interface SidebarProps {
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
  const sidebarLayout = useDefaultLayout({ id: 'sidebar-panels', storage: localStorage })
  const { activeConnection, activeDatabase, loadingSchema, schema, onRefreshSchema, ...connectionProps } = props

  return (
    <Box component="aside" sx={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, borderRight: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Group orientation="vertical" id="sidebar-panels" defaultLayout={sidebarLayout.defaultLayout} onLayoutChanged={sidebarLayout.onLayoutChanged} style={{ height: '100%' }}>
        <Panel id="connections" defaultSize="42%" minSize={96}>
          <ConnectionsPanel {...connectionProps} activeConnection={activeConnection} activeDatabase={activeDatabase} />
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
    </Box>
  )
})
