import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded'
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded'
import DeleteSweepRounded from '@mui/icons-material/DeleteSweepRounded'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography
} from '@mui/material'
import type { QueryResult } from '../../../shared/types'
import { cellsToTsv, resultValueText, rowsToTsv } from '../results/result-copy'
import { queryMessageSummary } from '../results/query-messages'
import {
  cellSelectionKey,
  selectCells,
  selectRows,
  selectedCellPositions,
  type CellPosition,
  type SelectionModifiers
} from '../results/result-selection'
import { ResultDataGrid } from '../results/ResultDataGrid'

interface ResultsPanelProps {
  result: QueryResult | null
  error: string | null
  onClear: () => void
}

type ResultView = 'results' | 'messages'

function selectionModifiers(event: MouseEvent<HTMLElement>): SelectionModifiers {
  return {
    extend: event.shiftKey,
    additive: event.metaKey || event.ctrlKey
  }
}

export const ResultsPanel = memo(function ResultsPanel({ result, error, onClear }: ResultsPanelProps) {
  const [activeView, setActiveView] = useState<ResultView>('results')
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set())
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [copyAnchor, setCopyAnchor] = useState<HTMLElement | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const cellAnchorRef = useRef<CellPosition | null>(null)
  const rowAnchorRef = useRef<number | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedCellsInOrder = useMemo(() => selectedCellPositions(selectedCells), [selectedCells])
  const messageSummary = useMemo(() => queryMessageSummary(result, error), [error, result])
  const selectedRowIndexes = useMemo(
    () => [...selectedRows].filter((index) => index < (result?.rows.length ?? 0)).sort((left, right) => left - right),
    [result, selectedRows]
  )
  const canCopyResults = Boolean(result?.columns.length)

  useEffect(() => {
    setSelectedCells(new Set())
    setSelectedRows(new Set())
    setCopyAnchor(null)
    cellAnchorRef.current = null
    rowAnchorRef.current = null
  }, [result])

  useEffect(() => {
    if (error || result?.message) setActiveView('messages')
    else if (result) setActiveView('results')
  }, [error, result])

  useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
  }, [])

  const showCopyStatus = (message: string): void => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    setCopyStatus(message)
    statusTimerRef.current = setTimeout(() => {
      setCopyStatus(null)
      statusTimerRef.current = null
    }, 1800)
  }

  const writeClipboard = async (text: string, successMessage: string): Promise<void> => {
    setCopyAnchor(null)
    try {
      await window.latch.writeClipboard(text)
      showCopyStatus(successMessage)
    } catch {
      showCopyStatus('Copy failed')
    }
  }

  const copyCells = (includeHeaders = false): void => {
    if (!result || selectedCellsInOrder.length === 0) return

    const onlyCell = selectedCellsInOrder.length === 1 ? selectedCellsInOrder[0] : null
    const text = onlyCell && !includeHeaders
      ? resultValueText(result.rows[onlyCell.rowIndex]?.[result.columns[onlyCell.columnIndex]])
      : cellsToTsv(result.columns, result.rows, selectedCellsInOrder, includeHeaders)
    const count = selectedCellsInOrder.length
    void writeClipboard(
      text,
      `${count} cell${count === 1 ? '' : 's'} copied${includeHeaders ? ' with headers' : ''}`
    )
  }

  const copyRows = (rowIndexes: number[], includeHeaders: boolean): void => {
    if (!result) return
    const rows = rowIndexes.map((index) => result.rows[index]).filter((row) => row !== undefined)
    const count = rows.length
    void writeClipboard(
      rowsToTsv(result.columns, rows, includeHeaders),
      `${count} row${count === 1 ? '' : 's'} copied${includeHeaders ? ' with headers' : ''}`
    )
  }

  const copyAllRows = (includeHeaders: boolean): void => {
    if (!result) return
    void writeClipboard(
      rowsToTsv(result.columns, result.rows, includeHeaders),
      `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} copied${includeHeaders ? ' with headers' : ''}`
    )
  }

  const copyMessages = (): void => {
    if (!messageSummary.copyText) return
    void writeClipboard(messageSummary.copyText, 'Messages copied')
  }

  const handleRowSelection = useCallback((rowIndex: number, event: MouseEvent<HTMLElement>): void => {
    event.stopPropagation()
    const modifiers = selectionModifiers(event)
    const anchor = rowAnchorRef.current
    setSelectedCells(new Set())
    setSelectedRows((current) => selectRows(current, anchor, rowIndex, modifiers))
    cellAnchorRef.current = null
    if (!modifiers.extend || rowAnchorRef.current === null) rowAnchorRef.current = rowIndex
  }, [])

  const handleSelectedRowsChange = useCallback((nextSelectedRows: Set<number>): void => {
    setSelectedCells(new Set())
    setSelectedRows(nextSelectedRows)
    cellAnchorRef.current = null
    rowAnchorRef.current = null
  }, [])

  const handleCellSelection = useCallback((rowIndex: number, columnIndex: number, modifiers: SelectionModifiers): void => {
    const target = { rowIndex, columnIndex }
    const anchor = cellAnchorRef.current
    setSelectedRows(new Set())
    setSelectedCells((current) => selectCells(current, anchor, target, modifiers))
    rowAnchorRef.current = null
    if (!modifiers.extend || cellAnchorRef.current === null) cellAnchorRef.current = target
  }, [])

  const clearSelection = useCallback((): void => {
    setSelectedCells(new Set())
    setSelectedRows(new Set())
    cellAnchorRef.current = null
    rowAnchorRef.current = null
  }, [])

  const openCopyMenu = (event: MouseEvent<HTMLElement>): void => {
    setCopyAnchor(event.currentTarget)
  }

  const openCellMenu = useCallback((event: MouseEvent<HTMLElement>, rowIndex: number, columnIndex: number, selected: boolean): void => {
    event.preventDefault()
    const target = { rowIndex, columnIndex }
    if (!selected) {
      setSelectedRows(new Set())
      setSelectedCells(new Set([cellSelectionKey(target)]))
      cellAnchorRef.current = target
      rowAnchorRef.current = null
    }
    setCopyAnchor(event.currentTarget)
  }, [])

  const openRowMenu = useCallback((event: MouseEvent<HTMLElement>, rowIndex: number, selected: boolean): void => {
    event.preventDefault()
    if (!selected) {
      setSelectedCells(new Set())
      setSelectedRows(new Set([rowIndex]))
      cellAnchorRef.current = null
      rowAnchorRef.current = rowIndex
    }
    setCopyAnchor(event.currentTarget)
  }, [])

  const handleCopyShortcut = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 'c') return
    if (activeView === 'messages') return
    if (selectedCellsInOrder.length > 0) {
      event.preventDefault()
      copyCells()
    } else if (selectedRowIndexes.length > 0) {
      event.preventDefault()
      copyRows(selectedRowIndexes, false)
    }
  }

  return (
    <Box onKeyDown={handleCopyShortcut} sx={{ width: '100%', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'var(--latch-shell)' }}>
      <Stack direction="row" sx={{ minHeight: 40, alignItems: 'center', px: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Tabs
          value={activeView}
          onChange={(_event, value: ResultView) => setActiveView(value)}
          sx={{ minHeight: 40, alignSelf: 'stretch', '& .MuiTabs-indicator': { height: 2 }, '& .MuiTab-root': { minWidth: 0, minHeight: 40, px: 1, py: 0, fontSize: 10.5, textTransform: 'none' } }}
        >
          <Tab
            value="results"
            label={<Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}><span>Results</span>{result && result.columns.length > 0 && <Chip label={result.rowCount} size="small" sx={{ height: 18, fontSize: 9 }} />}</Stack>}
          />
          <Tab value="messages" label="Messages" />
        </Tabs>
        <Box sx={{ flex: 1 }} />
        {copyStatus && <Typography variant="caption" color={copyStatus === 'Copy failed' ? 'error.main' : 'primary.main'} sx={{ mr: 1 }}>{copyStatus}</Typography>}
        {result && <Typography variant="caption" color="text.disabled" sx={{ mr: 1, fontFamily: '"DM Mono"' }}>{result.durationMs.toFixed(1)} ms</Typography>}
        <Button
          size="small"
          color="inherit"
          disabled={activeView === 'results' ? !canCopyResults : !messageSummary.copyText}
          startIcon={<ContentCopyRounded />}
          endIcon={activeView === 'results' ? <ArrowDropDownRounded /> : undefined}
          onClick={activeView === 'results' ? openCopyMenu : copyMessages}
          sx={{ minWidth: 0, height: 28, px: 0.75, fontSize: 10.5 }}
        >
          Copy
        </Button>
        <Tooltip title="Clear results"><IconButton size="small" onClick={onClear}><DeleteSweepRounded sx={{ fontSize: 16 }} /></IconButton></Tooltip>
      </Stack>

      <Menu
        anchorEl={copyAnchor}
        open={Boolean(copyAnchor)}
        onClose={() => setCopyAnchor(null)}
        slotProps={{ list: { dense: true }, paper: { sx: { minWidth: 230 } } }}
      >
        <MenuItem disabled={selectedCellsInOrder.length === 0} onClick={() => copyCells(false)}>Copy selected cell{selectedCellsInOrder.length === 1 ? '' : 's'} <Box component="span" sx={{ flex: 1 }} /><Typography variant="caption" color="text.disabled">⌘C</Typography></MenuItem>
        <MenuItem disabled={selectedCellsInOrder.length === 0} onClick={() => copyCells(true)}>Copy selected cell{selectedCellsInOrder.length === 1 ? '' : 's'} with headers</MenuItem>
        <Divider />
        <MenuItem disabled={selectedRowIndexes.length === 0} onClick={() => copyRows(selectedRowIndexes, false)}>
          Copy selected row{selectedRowIndexes.length === 1 ? '' : 's'}
        </MenuItem>
        <MenuItem disabled={selectedRowIndexes.length === 0} onClick={() => copyRows(selectedRowIndexes, true)}>
          Copy selected row{selectedRowIndexes.length === 1 ? '' : 's'} with headers
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => copyAllRows(false)}>Copy all rows</MenuItem>
        <MenuItem onClick={() => copyAllRows(true)}>Copy all rows with headers</MenuItem>
      </Menu>

      {activeView === 'results' ? (
      <Box onClick={clearSelection} sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {!result && (
          <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', gap: 1, color: 'text.disabled' }}>
            <Box sx={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: '50%', border: '1px solid', borderColor: 'divider' }}><PlayArrowRounded sx={{ fontSize: 17 }} /></Box>
            <Typography variant="caption">{error ? 'Query failed — see Messages' : 'Run a query to see results'}</Typography>
          </Stack>
        )}
        {result && result.columns.length === 0 && (
          <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
            <Typography variant="caption">No result set — see Messages</Typography>
          </Stack>
        )}
        {result && result.columns.length > 0 && (
          <ResultDataGrid
            result={result}
            selectedCells={selectedCells}
            selectedRows={selectedRows}
            onSelectedRowsChange={handleSelectedRowsChange}
            onRowSelection={handleRowSelection}
            onCellSelection={handleCellSelection}
            onOpenRowMenu={openRowMenu}
            onOpenCellMenu={openCellMenu}
          />
        )}
      </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
          {messageSummary.kind === 'idle' ? (
            <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', gap: 0.75, color: 'text.disabled' }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{messageSummary.title}</Typography>
              <Typography variant="caption">{messageSummary.lines[0]}</Typography>
            </Stack>
          ) : (
            <Alert severity={messageSummary.kind} variant="outlined" sx={{ alignItems: 'flex-start', '& .MuiAlert-message': { width: '100%' } }}>
              <Typography variant="caption" sx={{ display: 'block', mb: 0.75, fontWeight: 700 }}>{messageSummary.title}</Typography>
              {messageSummary.lines.map((line, index) => (
                <Typography key={`${index}:${line}`} variant="caption" component="div" sx={{ color: index === 0 ? 'text.primary' : 'text.secondary', fontFamily: index === 0 && messageSummary.kind === 'error' ? '"DM Mono", monospace' : 'inherit', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {line}
                </Typography>
              ))}
            </Alert>
          )}
        </Box>
      )}
    </Box>
  )
})
