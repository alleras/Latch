import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent } from 'react'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { Box, Button, Chip, InputAdornment, Menu, MenuItem, Stack, TextField, Typography, useTheme } from '@mui/material'
import type { Connection, DatabaseObject, ProviderDefinition } from '../../../shared/types'
import { sqlLanguageForProvider } from '../features/query-workspace/editor/monaco-config'
import { useMonacoWorkspace } from '../features/query-workspace/editor/useMonacoWorkspace'
import { ProviderIcon, providerColor } from './ProviderIcon'

export interface SqlEditorHandle {
  focus: () => void
  getQuery: () => string
  getSelectedQuery: () => string
}

interface SqlEditorProps {
  tabId: string
  openTabIds: string[]
  connection: Connection
  provider?: ProviderDefinition
  database?: string
  databases: string[]
  schema: DatabaseObject[]
  initialQuery: string
  running: boolean
  onDatabaseChange: (database: string) => void
  onQueryChange: (tabId: string, query: string) => void
  onRun: () => void
}

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { tabId, openTabIds, connection, provider, database, databases, schema, initialQuery, running, onDatabaseChange, onQueryChange, onRun },
  ref
) {
  const muiTheme = useTheme()
  const color = providerColor[connection.provider]
  const language = sqlLanguageForProvider(connection.provider)
  const editorTheme = muiTheme.palette.mode === 'dark' ? 'latch-dark' : 'latch-light'
  const editorHostRef = useRef<HTMLDivElement>(null)
  const [databaseAnchor, setDatabaseAnchor] = useState<HTMLElement | null>(null)
  const [databaseFilter, setDatabaseFilter] = useState('')

  const filteredDatabases = useMemo(() => {
    const normalizedFilter = databaseFilter.trim().toLocaleLowerCase()
    if (!normalizedFilter) return databases
    return databases.filter((name) => name.toLocaleLowerCase().includes(normalizedFilter))
  }, [databaseFilter, databases])

  const monacoWorkspace = useMonacoWorkspace({
    hostRef: editorHostRef,
    tabId,
    openTabIds,
    initialQuery,
    language,
    theme: editorTheme,
    ariaLabel: `${provider?.label ?? connection.provider} SQL editor`,
    schema,
    onQueryChange,
    onRun
  })

  useImperativeHandle(ref, () => monacoWorkspace, [monacoWorkspace])

  useEffect(() => {
    setDatabaseAnchor(null)
    setDatabaseFilter('')
  }, [tabId])

  const openDatabaseMenu = (event: MouseEvent<HTMLElement>): void => {
    setDatabaseAnchor(event.currentTarget)
  }

  const closeDatabaseMenu = (): void => {
    setDatabaseAnchor(null)
    setDatabaseFilter('')
  }

  const selectDatabase = (name: string): void => {
    onDatabaseChange(name)
    closeDatabaseMenu()
  }

  return (
    <Box sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'var(--latch-editor)' }}>
      <Stack direction="row" sx={{ minHeight: 42, alignItems: 'center', px: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        {databases.length > 0 ? (
          <>
            <Button
              aria-controls={databaseAnchor ? 'database-switcher' : undefined}
              aria-expanded={databaseAnchor ? 'true' : undefined}
              aria-haspopup="menu"
              onClick={openDatabaseMenu}
              size="small"
              variant="outlined"
              startIcon={<ProviderIcon provider={connection.provider} />}
              endIcon={<ExpandMoreRounded />}
              sx={{
                height: 27,
                maxWidth: 360,
                px: 1,
                color,
                borderColor: `${color}40`,
                borderRadius: 999,
                bgcolor: `${color}08`,
                fontWeight: 500,
                textTransform: 'none',
                '& .MuiButton-startIcon': { color },
                '& .MuiButton-endIcon': { ml: 0.5 },
                '&:hover': { borderColor: `${color}70`, bgcolor: `${color}12` }
              }}
            >
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {connection.name}{database ? ` / ${database}` : ''}
              </Box>
            </Button>
            <Menu
              id="database-switcher"
              anchorEl={databaseAnchor}
              open={Boolean(databaseAnchor)}
              onClose={closeDatabaseMenu}
              autoFocus={false}
              disableAutoFocusItem
              slotProps={{
                paper: { sx: { width: 320, maxWidth: 'calc(100vw - 32px)', mt: 0.5 } },
                list: { sx: { pt: 0, pb: 0.5 } }
              }}
            >
              <Box
                sx={{ position: 'sticky', top: 0, zIndex: 1, p: 1, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <TextField
                  autoFocus
                  fullWidth
                  size="small"
                  placeholder={`Filter ${databases.length} databases`}
                  value={databaseFilter}
                  onChange={(event) => setDatabaseFilter(event.target.value)}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }}
                />
              </Box>
              <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
                {filteredDatabases.map((name) => (
                  <MenuItem key={name} selected={name === database} onClick={() => selectDatabase(name)} sx={{ minHeight: 34, py: 0.25, fontSize: 14 }}>
                    <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Box>
                    {name === database && <CheckRounded color="primary" sx={{ ml: 1, fontSize: 16 }} />}
                  </MenuItem>
                ))}
                {filteredDatabases.length === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 2, textAlign: 'center' }}>
                    No matching databases
                  </Typography>
                )}
              </Box>
            </Menu>
          </>
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
        <Button size="small" variant="contained" startIcon={<PlayArrowRounded />} onClick={onRun} loading={running}>Run query</Button>
      </Stack>
      <Box ref={editorHostRef} sx={{ minHeight: 0, flex: 1, overflow: 'hidden' }} />
    </Box>
  )
})
