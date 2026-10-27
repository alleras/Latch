import { forwardRef, useImperativeHandle, useRef } from 'react'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import { Box, Button, Chip, Stack, Typography, useTheme } from '@mui/material'
import type { Connection, DatabaseObject, ProviderDefinition } from '../../../shared/types'
import { sqlLanguageForProvider } from '../features/query-workspace/editor/monaco-config'
import { useMonacoWorkspace } from '../features/query-workspace/editor/useMonacoWorkspace'
import { ProviderIcon, providerColor } from './ProviderIcon'
import { DatabasePicker } from './DatabasePicker'

export interface SqlEditorHandle {
  focus: () => void
  getQuery: () => string
  getSelectedQuery: () => string
  /** The tab's current Monaco version id, or null when it has no model yet. */
  getVersionId: (tabId: string) => number | null
  /** Makes a version of the tab's text the unsaved baseline: the given one, or the current one. */
  markSaved: (tabId: string, versionId?: number) => void
  /** Replaces the tab's text silently and marks it saved. */
  replaceQuery: (tabId: string, query: string) => void
}

interface SqlEditorProps {
  tabId: string
  openTabIds: string[]
  /** Null for a tab with no execution target; the editor still renders but cannot run. */
  connection: Connection | null
  provider?: ProviderDefinition
  database?: string
  databases: string[]
  schema: DatabaseObject[]
  initialQuery: string
  running: boolean
  /** True while a restored file tab's text is still being read; editing, running and saving wait. */
  loading: boolean
  onDatabaseChange: (database: string) => void
  onQueryChange: (tabId: string, query: string, unsaved: boolean) => void
  onRun: () => void
}

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { tabId, openTabIds, connection, provider, database, databases, schema, initialQuery, running, loading, onDatabaseChange, onQueryChange, onRun },
  ref
) {
  const muiTheme = useTheme()
  // The provider color is only rendered inside the connected branch below.
  const color = connection ? providerColor[connection.provider] : 'transparent'
  const language = connection ? sqlLanguageForProvider(connection.provider) : 'sql'
  const editorTheme = muiTheme.palette.mode === 'dark' ? 'latch-dark' : 'latch-light'
  const editorHostRef = useRef<HTMLDivElement>(null)
  const monacoWorkspace = useMonacoWorkspace({
    hostRef: editorHostRef,
    tabId,
    openTabIds,
    initialQuery,
    language,
    theme: editorTheme,
    ariaLabel: connection ? `${provider?.label ?? connection.provider} SQL editor` : 'SQL editor',
    readOnly: loading,
    schema,
    onQueryChange,
    onRun
  })

  useImperativeHandle(ref, () => monacoWorkspace, [monacoWorkspace])

  return (
    <Box sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'var(--latch-editor)' }}>
      <Stack direction="row" sx={{ minHeight: 42, alignItems: 'center', px: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        {connection === null ? (
          <Chip label="No connection" variant="outlined" sx={{ height: 27, color: 'text.secondary' }} />
        ) : databases.length > 0 ? (
          <DatabasePicker key={tabId} connection={connection} database={database} databases={databases} onDatabaseChange={onDatabaseChange} />
        ) : (
          <Chip
            icon={<ProviderIcon provider={connection.provider} />}
            label={`${connection.name}${database ? ` / ${database}` : ''}`}
            variant="outlined"
            sx={{ height: 27, color, borderColor: `${color}40`, bgcolor: `${color}08`, '& .MuiChip-icon': { color } }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.disabled" sx={{ mr: 1, fontFamily: '"DM Mono"' }}>⌘ ↵</Typography>
        <Button size="small" variant="contained" startIcon={<PlayArrowRounded />} onClick={onRun} loading={running} disabled={connection === null || loading}>Run query</Button>
      </Stack>
      <Box ref={editorHostRef} sx={{ minHeight: 0, flex: 1, overflow: 'hidden' }} />
    </Box>
  )
})
