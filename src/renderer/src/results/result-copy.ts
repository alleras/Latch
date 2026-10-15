import { cellSelectionKey, type CellPosition } from './result-selection'

export function resultValueText(value: unknown): string {
  if (value === null) return 'NULL'
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function tsvValue(value: unknown): string {
  const text = resultValueText(value)
  return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function rowsToTsv(
  columns: string[],
  rows: Record<string, unknown>[],
  includeHeaders: boolean
): string {
  const lines = rows.map((row) => columns.map((column) => tsvValue(row[column])).join('\t'))
  if (includeHeaders) lines.unshift(columns.map(tsvValue).join('\t'))
  return lines.join('\n')
}

export function cellsToTsv(
  columns: string[],
  rows: Record<string, unknown>[],
  cells: CellPosition[],
  includeHeaders: boolean
): string {
  if (cells.length === 0) return ''

  const selected = new Set(cells.map(cellSelectionKey))
  const rowIndexes = [...new Set(cells.map((cell) => cell.rowIndex))].sort((left, right) => left - right)
  const columnIndexes = [...new Set(cells.map((cell) => cell.columnIndex))].sort((left, right) => left - right)
  const lines = rowIndexes.map((rowIndex) => columnIndexes.map((columnIndex) => (
    selected.has(cellSelectionKey({ rowIndex, columnIndex }))
      ? tsvValue(rows[rowIndex]?.[columns[columnIndex]])
      : ''
  )).join('\t'))

  if (includeHeaders) lines.unshift(columnIndexes.map((columnIndex) => tsvValue(columns[columnIndex])).join('\t'))
  return lines.join('\n')
}
