import { memo, useCallback, useMemo, type Key, type MouseEvent as ReactMouseEvent } from 'react'
import { Checkbox } from '@mui/material'
import {
  Cell,
  DataGrid,
  useHeaderRowSelection,
  useRowSelection,
  type CellRendererProps,
  type Column,
  type RenderCellProps,
  type RenderHeaderCellProps,
  type Renderers
} from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import type { QueryResult } from '../../../shared/types'
import { resultValueText } from './result-copy'
import type { SelectionModifiers } from './result-selection'

const RESULT_ROW_HEIGHT = 32
const RESULT_HEADER_HEIGHT = 36
const ROW_NUMBER_WIDTH = 58
const MIN_COLUMN_WIDTH = 120
const MAX_COLUMN_WIDTH = 360
const WIDTH_SAMPLE_SIZE = 24
const SELECT_COLUMN_KEY = 'latch-select-row'
const DATA_COLUMN_PREFIX = 'latch-result-column:'

type ResultRow = QueryResult['rows'][number]

interface ResultDataGridProps {
  result: QueryResult
  selectedCells: Set<string>
  selectedRows: Set<number>
  onSelectedRowsChange: (selectedRows: Set<number>) => void
  onRowSelection: (rowIndex: number, event: ReactMouseEvent<HTMLElement>) => void
  onCellSelection: (rowIndex: number, columnIndex: number, modifiers: SelectionModifiers) => void
  onOpenRowMenu: (event: ReactMouseEvent<HTMLElement>, rowIndex: number, selected: boolean) => void
  onOpenCellMenu: (event: ReactMouseEvent<HTMLElement>, rowIndex: number, columnIndex: number, selected: boolean) => void
}

interface RowNumberCellProps {
  row: ResultRow
  rowIndex: number
  tabIndex: number
  onRowSelection: ResultDataGridProps['onRowSelection']
}

function estimatedValueLength(value: unknown): number {
  if (value === null || value === undefined) return 4
  if (typeof value === 'string') return value.length
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value).length
  if (value instanceof Date) return 24
  return 20
}

function initialColumnWidths(result: QueryResult): number[] {
  const sampleCount = Math.min(result.rows.length, WIDTH_SAMPLE_SIZE)
  return result.columns.map((column) => {
    let characterCount = column.length
    for (let rowIndex = 0; rowIndex < sampleCount; rowIndex += 1) {
      characterCount = Math.max(characterCount, estimatedValueLength(result.rows[rowIndex][column]))
    }
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, characterCount * 8 + 28))
  })
}

function dataColumnIndex(columnKey: string): number | null {
  if (!columnKey.startsWith(DATA_COLUMN_PREFIX)) return null
  const index = Number(columnKey.slice(DATA_COLUMN_PREFIX.length))
  return Number.isInteger(index) ? index : null
}

function SelectAllRowsHeader({ tabIndex }: Pick<RenderHeaderCellProps<ResultRow>, 'tabIndex'>) {
  const { isIndeterminate, isRowSelected, onRowSelectionChange } = useHeaderRowSelection()

  return (
    <Checkbox
      size="small"
      tabIndex={tabIndex}
      checked={isRowSelected}
      indeterminate={isIndeterminate}
      onChange={(event) => onRowSelectionChange({ checked: isIndeterminate ? false : event.target.checked })}
      onClick={(event) => event.stopPropagation()}
      slotProps={{ input: { 'aria-label': 'Select all result rows' } }}
      sx={{ p: 0.25 }}
    />
  )
}

function RowNumberCell({ row, rowIndex, tabIndex, onRowSelection }: RowNumberCellProps) {
  const { isRowSelectionDisabled, isRowSelected, onRowSelectionChange } = useRowSelection()

  return (
    <div className="latch-result-row-number" onClick={(event) => onRowSelection(rowIndex, event)}>
      <Checkbox
        size="small"
        tabIndex={tabIndex}
        checked={isRowSelected}
        disabled={isRowSelectionDisabled}
        onChange={(event) => {
          const nativeEvent = event.nativeEvent as globalThis.MouseEvent
          onRowSelectionChange({ row, checked: event.target.checked, isShiftClick: nativeEvent.shiftKey })
        }}
        onClick={(event) => event.stopPropagation()}
        slotProps={{ input: { 'aria-label': `Select result row ${rowIndex + 1}` } }}
        sx={{ p: 0.25 }}
      />
      <span>{rowIndex + 1}</span>
    </div>
  )
}

export const ResultDataGrid = memo(function ResultDataGrid({
  result,
  selectedCells,
  selectedRows,
  onSelectedRowsChange,
  onRowSelection,
  onCellSelection,
  onOpenRowMenu,
  onOpenCellMenu
}: ResultDataGridProps) {
  const rowIndexes = useMemo(() => {
    const indexes = new WeakMap<ResultRow, number>()
    result.rows.forEach((row, index) => indexes.set(row, index))
    return indexes
  }, [result.rows])
  const automaticWidths = useMemo(() => initialColumnWidths(result), [result])
  const rowKeyGetter = useCallback((row: ResultRow) => rowIndexes.get(row) ?? -1, [rowIndexes])

  const columns = useMemo<readonly Column<ResultRow>[]>(() => {
    const selectColumn: Column<ResultRow> = {
      key: SELECT_COLUMN_KEY,
      name: '',
      width: ROW_NUMBER_WIDTH,
      minWidth: ROW_NUMBER_WIDTH,
      maxWidth: ROW_NUMBER_WIDTH,
      frozen: true,
      resizable: false,
      cellClass: 'latch-result-row-number-cell',
      headerCellClass: 'latch-result-row-number-cell',
      renderHeaderCell: ({ tabIndex }) => <SelectAllRowsHeader tabIndex={tabIndex} />,
      renderCell: ({ row, rowIdx, tabIndex }: RenderCellProps<ResultRow>) => (
        <RowNumberCell row={row} rowIndex={rowIdx} tabIndex={tabIndex} onRowSelection={onRowSelection} />
      )
    }

    const dataColumns = result.columns.map<Column<ResultRow>>((columnName, columnIndex) => ({
      key: `${DATA_COLUMN_PREFIX}${columnIndex}`,
      name: columnName,
      width: automaticWidths[columnIndex],
      minWidth: 64,
      resizable: true,
      cellClass: (row) => {
        const classes = ['latch-result-data-cell']
        if (row[columnName] === null) classes.push('latch-result-null-cell')
        return classes.join(' ')
      },
      renderCell: ({ row }) => {
        const text = resultValueText(row[columnName])
        return <span className="latch-result-cell-value" title={text}>{text}</span>
      }
    }))

    return [selectColumn, ...dataColumns]
  }, [automaticWidths, onRowSelection, result.columns])

  const renderers = useMemo<Renderers<ResultRow, unknown>>(() => ({
    renderCell: (key: Key, props: CellRendererProps<ResultRow, unknown>) => {
      const columnIndex = dataColumnIndex(props.column.key)
      const selected = columnIndex !== null && selectedCells.has(`${props.rowIdx}:${columnIndex}`)
      return (
        <Cell
          key={key}
          {...props}
          className={selected ? 'latch-result-cell-selected' : undefined}
          onClick={(event) => {
            // Use the original React event: stopping the grid's cloned cell
            // event does not stop React from running the outside-click handler.
            event.stopPropagation()
            if (columnIndex === null) {
              onRowSelection(props.rowIdx, event)
              return
            }
            onCellSelection(props.rowIdx, columnIndex, {
              extend: event.shiftKey,
              additive: event.metaKey || event.ctrlKey
            })
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (columnIndex === null) {
              onOpenRowMenu(event, props.rowIdx, selectedRows.has(props.rowIdx))
              return
            }
            onOpenCellMenu(event, props.rowIdx, columnIndex, selected)
          }}
        />
      )
    }
  }), [onCellSelection, onOpenCellMenu, onOpenRowMenu, onRowSelection, selectedCells, selectedRows])

  return (
    <div className="latch-result-grid-host">
      <DataGrid<ResultRow, unknown, number>
        aria-label="Query results"
        className="latch-result-grid"
        columns={columns}
        rows={result.rows}
        rowKeyGetter={rowKeyGetter}
        rowHeight={RESULT_ROW_HEIGHT}
        headerRowHeight={RESULT_HEADER_HEIGHT}
        selectedRows={selectedRows}
        onSelectedRowsChange={onSelectedRowsChange}
        renderers={renderers}
        enableVirtualization
        style={{ height: '100%' }}
      />
    </div>
  )
})
