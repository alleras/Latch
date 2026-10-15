import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent } from 'react'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import { Box, Button, Chip, InputAdornment, Menu, MenuItem, Stack, TextField, Typography, useTheme } from '@mui/material'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/esm/vs/basic-languages/mysql/mysql.contribution'
import 'monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import type { Connection, DatabaseObject, ProviderDefinition, ProviderId } from '../../../shared/types'
import { ProviderIcon, providerColor } from './ProviderIcon'

const monacoGlobal = self as typeof self & {
  MonacoEnvironment?: { getWorker: (_moduleId: string, _label: string) => Worker }
}

monacoGlobal.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

const languageByProvider: Record<ProviderId, string> = {
  sqlite: 'sql',
  postgresql: 'pgsql',
  mysql: 'mysql',
  sqlserver: 'sql',
  azuresql: 'sql'
}

export interface SqlEditorHandle {
  focus: () => void
  getQuery: () => string
  getSelectedQuery: () => string
}

interface SqlEditorProps {
  connection: Connection
  provider?: ProviderDefinition
  database?: string
  databases: string[]
  schema: DatabaseObject[]
  initialQuery: string
  running: boolean
  onDatabaseChange: (database: string) => void
  onQueryChange: (query: string) => void
  onRun: () => void
}

function defineLatchThemes(): void {
  monaco.editor.defineTheme('latch-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '666d77', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c9f55f' },
      { token: 'keyword.sql', foreground: 'c9f55f' },
      { token: 'number', foreground: '80b8ff' },
      { token: 'string', foreground: '8ddd8a' },
      { token: 'operator', foreground: 'b8bec7' },
      { token: 'delimiter', foreground: '8f959e' }
    ],
    colors: {
      'editor.background': '#0f1216',
      'editor.foreground': '#e8ebe5',
      'editorCursor.foreground': '#c9f55f',
      'editor.lineHighlightBackground': '#15191e',
      'editorLineNumber.foreground': '#464c55',
      'editorLineNumber.activeForeground': '#8f959e',
      'editor.selectionBackground': '#c9f55f30',
      'editor.inactiveSelectionBackground': '#c9f55f18',
      'editorIndentGuide.background1': '#242830',
      'editorIndentGuide.activeBackground1': '#3b424c',
      'editorWidget.background': '#15191e',
      'editorWidget.border': '#30353e',
      'editorSuggestWidget.background': '#15191e',
      'editorSuggestWidget.border': '#30353e',
      'editorSuggestWidget.selectedBackground': '#252b32',
      'editorHoverWidget.background': '#15191e',
      'editorHoverWidget.border': '#30353e',
      'focusBorder': '#c9f55f55',
      'scrollbarSlider.background': '#343a4380',
      'scrollbarSlider.hoverBackground': '#464d5880'
    }
  })
  monaco.editor.defineTheme('latch-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7a838f', fontStyle: 'italic' },
      { token: 'keyword', foreground: '527500', fontStyle: 'bold' },
      { token: 'keyword.sql', foreground: '527500', fontStyle: 'bold' },
      { token: 'number', foreground: '2468a8' },
      { token: 'string', foreground: '287a3f' },
      { token: 'operator', foreground: '4c5663' },
      { token: 'delimiter', foreground: '697380' }
    ],
    colors: {
      'editor.background': '#fbfcfd',
      'editor.foreground': '#17202a',
      'editorCursor.foreground': '#527500',
      'editor.lineHighlightBackground': '#f2f4f6',
      'editorLineNumber.foreground': '#a1a9b3',
      'editorLineNumber.activeForeground': '#596370',
      'editor.selectionBackground': '#789f2430',
      'editor.inactiveSelectionBackground': '#789f2418',
      'editorIndentGuide.background1': '#dfe3e8',
      'editorIndentGuide.activeBackground1': '#b8c0ca',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#d2d8df',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#d2d8df',
      'editorSuggestWidget.selectedBackground': '#edf2e3',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#d2d8df',
      'focusBorder': '#5f840866',
      'scrollbarSlider.background': '#aeb6c080',
      'scrollbarSlider.hoverBackground': '#8e98a580'
    }
  })
}

export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { connection, provider, database, databases, schema, initialQuery, running, onDatabaseChange, onQueryChange, onRun },
  ref
) {
  const muiTheme = useTheme()
  const color = providerColor[connection.provider]
  const language = languageByProvider[connection.provider]
  const editorTheme = muiTheme.palette.mode === 'dark' ? 'latch-dark' : 'latch-light'
  const editorHostRef = useRef<HTMLDivElement>(null)
  const editorInstanceRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const initialQueryRef = useRef(initialQuery)
  const onRunRef = useRef(onRun)
  const onQueryChangeRef = useRef(onQueryChange)
  const schemaRef = useRef(schema)
  const [databaseAnchor, setDatabaseAnchor] = useState<HTMLElement | null>(null)
  const [databaseFilter, setDatabaseFilter] = useState('')

  onRunRef.current = onRun
  onQueryChangeRef.current = onQueryChange
  schemaRef.current = schema

  const filteredDatabases = useMemo(() => {
    const normalizedFilter = databaseFilter.trim().toLocaleLowerCase()
    if (!normalizedFilter) return databases
    return databases.filter((name) => name.toLocaleLowerCase().includes(normalizedFilter))
  }, [databaseFilter, databases])

  useImperativeHandle(ref, () => ({
    focus: () => editorInstanceRef.current?.focus(),
    getQuery: () => modelRef.current?.getValue() ?? initialQueryRef.current,
    getSelectedQuery: () => {
      const editor = editorInstanceRef.current
      const model = modelRef.current
      const selection = editor?.getSelection()
      return model && selection ? model.getValueInRange(selection) : ''
    }
  }), [])

  useEffect(() => {
    if (!editorHostRef.current) return

    defineLatchThemes()
    const model = monaco.editor.createModel(initialQueryRef.current, language)
    const editor = monaco.editor.create(editorHostRef.current, {
      model,
      theme: editorTheme,
      ariaLabel: `${provider?.label ?? connection.provider} SQL editor`,
      automaticLayout: true,
      fontFamily: '"DM Mono", monospace',
      fontSize: 12,
      lineHeight: 20,
      fontLigatures: false,
      minimap: { enabled: false },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      padding: { top: 12, bottom: 20 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderLineHighlight: 'all',
      renderWhitespace: 'selection',
      guides: { indentation: false },
      stickyScroll: { enabled: false },
      bracketPairColorization: { enabled: true },
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'off',
      quickSuggestions: false,
      suggestOnTriggerCharacters: true,
      suggest: { showKeywords: true, showFields: true, showClasses: true },
      scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 }
    })

    modelRef.current = model
    editorInstanceRef.current = editor

    const changeSubscription = model.onDidChangeContent(() => {
      onQueryChangeRef.current(model.getValue())
    })

    editor.addAction({
      id: 'latch.run-query',
      label: 'Run query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => onRunRef.current()
    })

    const completionProviders = ['sql', 'mysql', 'pgsql'].map((languageId) => (
      monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: ['.'],
        provideCompletionItems: (completionModel: monaco.editor.ITextModel, position: monaco.Position) => {
          const word = completionModel.getWordUntilPosition(position)
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn
          }
          const suggestions: monaco.languages.CompletionItem[] = []

          for (const table of schemaRef.current.filter((item) => item.type === 'table' || item.type === 'view')) {
            const qualifiedName = table.schema ? `${table.schema}.${table.name}` : table.name
            suggestions.push({
              label: qualifiedName,
              kind: monaco.languages.CompletionItemKind.Class,
              detail: table.type,
              insertText: qualifiedName,
              range,
              sortText: `1_${qualifiedName}`
            })
            for (const column of table.columns) {
              suggestions.push({
                label: column.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${qualifiedName} · ${column.type}`,
                insertText: column.name,
                range,
                sortText: `2_${column.name}_${qualifiedName}`
              })
            }
          }

          return { suggestions }
        }
      })
    ))

    return () => {
      completionProviders.forEach((registration) => registration.dispose())
      changeSubscription.dispose()
      editor.dispose()
      model.dispose()
      editorInstanceRef.current = null
      modelRef.current = null
    }
  }, [])

  useEffect(() => {
    if (modelRef.current) monaco.editor.setModelLanguage(modelRef.current, language)
  }, [language])

  useEffect(() => {
    monaco.editor.setTheme(editorTheme)
  }, [editorTheme])

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
                  <MenuItem key={name} selected={name === database} onClick={() => selectDatabase(name)} sx={{ minHeight: 32, py: 0.25, fontSize: 13 }}>
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
