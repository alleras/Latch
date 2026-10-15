import {
  memo,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent
} from 'react'
import { Checkbox } from '@mui/material'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { QueryResult } from '../../../shared/types'
import { resultValueText } from './result-copy'

const RESULT_ROW_HEIGHT = 30
const RESULT_ROW_OVERSCAN = 24
const ROW_NUMBER_WIDTH = 58
const MIN_COLUMN_WIDTH = 120
const MAX_COLUMN_WIDTH = 360
const MIN_RESIZED_COLUMN_WIDTH = 64
const KEYBOARD_RESIZE_STEP = 12
const WIDTH_SAMPLE_SIZE = 24

interface VirtualizedResultTableProps {
  result: QueryResult
  selectedCells: Set<string>
  selectedRows: Set<number>
  allRowsSelected: boolean
  someRowsSelected: boolean
  onToggleAllRows: () => void
  onRowSelection: (rowIndex: number, event: MouseEvent<HTMLElement>) => void
  onRowCheckboxSelection: (rowIndex: number, event: MouseEvent<HTMLElement>) => void
  onCellSelection: (rowIndex: number, columnIndex: number, event: MouseEvent<HTMLElement>) => void
  onOpenRowMenu: (event: MouseEvent<HTMLElement>, rowIndex: number, selected: boolean) => void
  onOpenCellMenu: (event: MouseEvent<HTMLElement>, rowIndex: number, columnIndex: number, selected: boolean) => void
}

interface ResultGridRowProps {
  row: QueryResult['rows'][number]
  rowIndex: number
  columns: string[]
  offset: number
  selected: boolean
  selectedCellMask: string
  onRowSelection: VirtualizedResultTableProps['onRowSelection']
  onRowCheckboxSelection: VirtualizedResultTableProps['onRowCheckboxSelection']
  onCellSelection: VirtualizedResultTableProps['onCellSelection']
  onOpenRowMenu: VirtualizedResultTableProps['onOpenRowMenu']
  onOpenCellMenu: VirtualizedResultTableProps['onOpenCellMenu']
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
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, characterCount * 7 + 28))
  })
}

function resultColumnLayout(widths: number[]): { gridTemplateColumns: string; contentWidth: number } {
  const contentWidth = ROW_NUMBER_WIDTH + widths.reduce((total, width) => total + width, 0)
  const dataColumns = widths.map((width, index) => (
    index === widths.length - 1 ? `minmax(${width}px, 1fr)` : `${width}px`
  ))

  return {
    gridTemplateColumns: `${ROW_NUMBER_WIDTH}px ${dataColumns.join(' ')}`,
    contentWidth
  }
}

const ResultGridRow = memo(function ResultGridRow({
  row,
  rowIndex,
  columns,
  offset,
  selected,
  selectedCellMask,
  onRowSelection,
  onRowCheckboxSelection,
  onCellSelection,
  onOpenRowMenu,
  onOpenCellMenu
}: ResultGridRowProps) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      aria-selected={selected}
      className={`result-grid-row${selected ? ' result-grid-row-selected' : ''}`}
      style={{ transform: `translateY(${offset}px)` }}
    >
      <div
        role="rowheader"
        className="result-grid-cell result-grid-row-number"
        onClick={(event) => onRowSelection(rowIndex, event)}
        onContextMenu={(event) => onOpenRowMenu(event, rowIndex, selected)}
      >
        <Checkbox
          size="small"
          checked={selected}
          onChange={() => undefined}
          onClick={(event) => onRowCheckboxSelection(rowIndex, event)}
          slotProps={{ input: { 'aria-label': `Select result row ${rowIndex + 1}` } }}
          sx={{ p: 0.25 }}
        />
        <span>{rowIndex + 1}</span>
      </div>
      {columns.map((column, columnIndex) => {
        const value = row[column]
        const text = resultValueText(value)
        const cellSelected = selectedCellMask[columnIndex] === '1'

        return (
          <div
            role="gridcell"
            key={`${column}:${columnIndex}`}
            tabIndex={0}
            aria-selected={cellSelected}
            title={text}
            className={`result-grid-cell result-grid-data-cell${cellSelected ? ' result-grid-cell-selected' : ''}${value === null ? ' result-grid-null-cell' : ''}`}
            onClick={(event) => {
              onCellSelection(rowIndex, columnIndex, event)
              event.currentTarget.focus()
            }}
            onContextMenu={(event) => onOpenCellMenu(event, rowIndex, columnIndex, cellSelected)}
          >
            {text}
          </div>
        )
      })}
    </div>
  )
})

export const VirtualizedResultTable = memo(function VirtualizedResultTable({
  result,
  selectedCells,
  selectedRows,
  allRowsSelected,
  someRowsSelected,
  onToggleAllRows,
  onRowSelection,
  onRowCheckboxSelection,
  onCellSelection,
  onOpenRowMenu,
  onOpenCellMenu
}: VirtualizedResultTableProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const automaticWidths = useMemo(() => initialColumnWidths(result), [result])
  const columnWidthsRef = useRef<{ result: QueryResult; widths: number[] }>({ result, widths: automaticWidths })
  const resizeRef = useRef<{
    pointerId: number
    columnIndex: number
    startX: number
    startWidth: number
    handle: HTMLDivElement
  } | null>(null)

  if (columnWidthsRef.current.result !== result) {
    columnWidthsRef.current = { result, widths: automaticWidths }
  }

  const layout = resultColumnLayout(columnWidthsRef.current.widths)
  const rowVirtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => RESULT_ROW_HEIGHT,
    overscan: RESULT_ROW_OVERSCAN
  })

  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
  }, [result])

  const applyColumnWidths = (widths: number[]): void => {
    const content = contentRef.current
    if (!content) return
    const nextLayout = resultColumnLayout(widths)
    content.style.width = `${nextLayout.contentWidth}px`
    content.style.setProperty('--result-grid-columns', nextLayout.gridTemplateColumns)
  }

  const setColumnWidth = (columnIndex: number, width: number): number => {
    const nextWidth = Math.max(MIN_RESIZED_COLUMN_WIDTH, Math.round(width))
    columnWidthsRef.current.widths[columnIndex] = nextWidth
    applyColumnWidths(columnWidthsRef.current.widths)
    return nextWidth
  }

  const startColumnResize = (event: PointerEvent<HTMLDivElement>, columnIndex: number): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.resizeActive = 'true'
    resizeRef.current = {
      pointerId: event.pointerId,
      columnIndex,
      startX: event.clientX,
      startWidth: columnWidthsRef.current.widths[columnIndex],
      handle: event.currentTarget
    }
  }

  const resizeColumn = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    const width = setColumnWidth(resize.columnIndex, resize.startWidth + event.clientX - resize.startX)
    resize.handle.setAttribute('aria-valuenow', String(width))
  }

  const finishColumnResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    if (resize.handle.hasPointerCapture(event.pointerId)) resize.handle.releasePointerCapture(event.pointerId)
    delete resize.handle.dataset.resizeActive
    resizeRef.current = null
  }

  const resizeColumnWithKeyboard = (event: KeyboardEvent<HTMLDivElement>, columnIndex: number): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const width = setColumnWidth(columnIndex, columnWidthsRef.current.widths[columnIndex] + direction * KEYBOARD_RESIZE_STEP)
    event.currentTarget.setAttribute('aria-valuenow', String(width))
  }

  const autoSizeColumn = (event: MouseEvent<HTMLDivElement>, columnIndex: number): void => {
    event.preventDefault()
    event.stopPropagation()
    const width = setColumnWidth(columnIndex, automaticWidths[columnIndex])
    event.currentTarget.setAttribute('aria-valuenow', String(width))
  }

  const contentStyle = {
    width: layout.contentWidth,
    '--result-grid-columns': layout.gridTemplateColumns
  } as CSSProperties

  return (
    <div
      ref={scrollContainerRef}
      role="grid"
      aria-rowcount={result.rows.length + 1}
      aria-colcount={result.columns.length + 1}
      className="result-grid-scroll"
    >
      <div ref={contentRef} className="result-grid-content" style={contentStyle}>
        <div role="row" className="result-grid-header">
          <div role="columnheader" className="result-grid-header-cell result-grid-header-select">
            <Checkbox
              size="small"
              checked={allRowsSelected}
              indeterminate={someRowsSelected}
              disabled={result.rows.length === 0}
              onChange={onToggleAllRows}
              onClick={(event) => event.stopPropagation()}
              slotProps={{ input: { 'aria-label': 'Select all result rows' } }}
              sx={{ p: 0.5 }}
            />
          </div>
          {result.columns.map((column, columnIndex) => (
            <div role="columnheader" className="result-grid-header-cell" title={column} key={`${column}:${columnIndex}`}>
              <span className="result-grid-header-label">{column}</span>
              <div
                role="separator"
                aria-label={`Resize ${column} column`}
                aria-orientation="vertical"
                aria-valuemin={MIN_RESIZED_COLUMN_WIDTH}
                aria-valuenow={columnWidthsRef.current.widths[columnIndex]}
                tabIndex={0}
                className="result-grid-column-resizer"
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => autoSizeColumn(event, columnIndex)}
                onPointerDown={(event) => startColumnResize(event, columnIndex)}
                onPointerMove={resizeColumn}
                onPointerUp={finishColumnResize}
                onPointerCancel={finishColumnResize}
                onKeyDown={(event) => resizeColumnWithKeyboard(event, columnIndex)}
              />
            </div>
          ))}
        </div>
        <div className="result-grid-body" style={{ height: rowVirtualizer.getTotalSize() }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowIndex = virtualRow.index
            const selectedCellMask = result.columns
              .map((_column, columnIndex) => selectedCells.has(`${rowIndex}:${columnIndex}`) ? '1' : '0')
              .join('')

            return (
              <ResultGridRow
                key={rowIndex}
                row={result.rows[rowIndex]}
                rowIndex={rowIndex}
                columns={result.columns}
                offset={virtualRow.start}
                selected={selectedRows.has(rowIndex)}
                selectedCellMask={selectedCellMask}
                onRowSelection={onRowSelection}
                onRowCheckboxSelection={onRowCheckboxSelection}
                onCellSelection={onCellSelection}
                onOpenRowMenu={onOpenRowMenu}
                onOpenCellMenu={onOpenCellMenu}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
})
