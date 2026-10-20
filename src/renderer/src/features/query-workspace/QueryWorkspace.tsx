import { memo, useCallback, useDeferredValue, useMemo, type RefObject } from 'react'
import DataObjectRounded from '@mui/icons-material/DataObjectRounded'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import type { Connection, DatabaseObject, ProviderDefinition } from '../../../../shared/types'
import { QueryTabs } from '../../components/QueryTabs'
import { ResultsPanel } from '../../components/ResultsPanel'
import { SqlEditor, type SqlEditorHandle } from '../../components/SqlEditor'
import { connectionDatabaseKey, type CloseTabScope, type QueryTabState } from '../../query-tabs'

interface QueryWorkspaceProps {
  tabs: QueryTabState[]
  activeTabId: string | null
  /** Owned by the query workspace controller so save workflows can reach the editor. */
  editorRef: RefObject<SqlEditorHandle | null>
  connections: Connection[]
  providers: ProviderDefinition[]
  databasesByConnection: Record<string, string[]>
  schemasByContext: Record<string, DatabaseObject[]>
  onSelectTab: (tabId: string) => void
  onCloseTabs: (tabId: string, scope?: CloseTabScope) => void
  onAddTab: () => void
  onDatabaseChange: (tabId: string, database: string) => void
  onQueryChange: (tabId: string, query: string, unsaved: boolean) => void
  queryForTab: (tabId: string) => string
  onRunQuery: (tabId: string, sql: string) => void
  onClearResults: (tabId: string) => void
}

interface TabResultsPanelProps {
  tab: QueryTabState
  active: boolean
  onClearResults: (tabId: string) => void
}

const TabResultsPanel = memo(function TabResultsPanel({ tab, active, onClearResults }: TabResultsPanelProps) {
  const clear = useCallback(() => onClearResults(tab.id), [onClearResults, tab.id])
  return (
    <Box
      aria-hidden={!active}
      sx={{ position: 'absolute', inset: 0, visibility: active ? 'visible' : 'hidden', pointerEvents: active ? 'auto' : 'none' }}
    >
      <ResultsPanel result={tab.result} error={tab.error} onClear={clear} />
    </Box>
  )
})

export const QueryWorkspace = memo(function QueryWorkspace({
  tabs,
  activeTabId,
  editorRef,
  connections,
  providers,
  databasesByConnection,
  schemasByContext,
  onSelectTab,
  onCloseTabs,
  onAddTab,
  onDatabaseChange,
  onQueryChange,
  queryForTab,
  onRunQuery,
  onClearResults
}: QueryWorkspaceProps) {
  const queryLayout = useDefaultLayout({ id: 'query-panels', storage: localStorage })
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const connection = connections.find((item) => item.id === activeTab?.connectionId) ?? null
  const provider = providers.find((item) => item.id === connection?.provider)
  const openTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs])
  const displayedResultsTabId = useDeferredValue(activeTabId)
  const retainedResultTabs = useMemo(
    () => tabs.filter((tab) => tab.id === displayedResultsTabId || tab.result !== null || tab.error !== null),
    [displayedResultsTabId, tabs]
  )

  const runActiveQuery = useCallback((): void => {
    if (!activeTab) return
    const selection = editorRef.current?.getSelectedQuery().trim()
    const sql = selection || editorRef.current?.getQuery() || ''
    if (sql.trim()) onRunQuery(activeTab.id, sql)
  }, [activeTab, onRunQuery])

  const changeActiveDatabase = useCallback((database: string): void => {
    if (activeTab) onDatabaseChange(activeTab.id, database)
  }, [activeTab, onDatabaseChange])

  return (
    <Box component="main" sx={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <QueryTabs
        tabs={tabs}
        connections={connections}
        activeTabId={activeTabId}
        onSelect={onSelectTab}
        onClose={onCloseTabs}
        onAdd={onAddTab}
      />

      {!activeTab || !connection ? (
        <Stack sx={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1.5, color: 'text.disabled' }}>
          <DataObjectRounded sx={{ fontSize: 28 }} />
          <Typography variant="body2">Open a query from a database or create a new tab.</Typography>
          <Button size="small" variant="outlined" onClick={onAddTab}>New query</Button>
        </Stack>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Group
            orientation="vertical"
            id="query-panels"
            defaultLayout={queryLayout.defaultLayout}
            onLayoutChanged={queryLayout.onLayoutChanged}
            style={{ flex: 1, minHeight: 0 }}
          >
            <Panel id="editor" defaultSize="54%" minSize={150}>
              <SqlEditor
                ref={editorRef}
                tabId={activeTab.id}
                openTabIds={openTabIds}
                connection={connection}
                provider={provider}
                database={activeTab.database}
                databases={databasesByConnection[connection.id] ?? []}
                schema={schemasByContext[connectionDatabaseKey(connection.id, activeTab.database)] ?? []}
                initialQuery={queryForTab(activeTab.id)}
                running={activeTab.running}
                onDatabaseChange={changeActiveDatabase}
                onQueryChange={onQueryChange}
                onRun={runActiveQuery}
              />
            </Panel>
            <Separator className="resize-handle" />
            <Panel id="results" defaultSize="46%" minSize={120}>
              <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
                {retainedResultTabs.map((tab) => (
                  <TabResultsPanel
                    key={tab.id}
                    tab={tab}
                    active={tab.id === displayedResultsTabId}
                    onClearResults={onClearResults}
                  />
                ))}
              </Box>
            </Panel>
          </Group>
          <Stack component="footer" direction="row" sx={{ height: 25, flex: '0 0 auto', alignItems: 'center', gap: 1, px: 1.25, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main', boxShadow: '0 0 0 3px rgba(141,221,138,.08)' }} />
            <Typography variant="caption" color="text.secondary">Connected</Typography>
            <Typography variant="caption" color="text.disabled">{activeTab.database ?? connection.name}</Typography>
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.disabled">{provider?.label}</Typography>
            <Typography variant="caption" color="text.disabled">UTF-8</Typography>
          </Stack>
        </Box>
      )}
    </Box>
  )
})
