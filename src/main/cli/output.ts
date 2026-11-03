/** Renders command results as JSON, aligned text tables, or CSV. */

export interface Table {
  columns: string[]
  rows: unknown[][]
}

const MAX_TABLE_CELL_WIDTH = 60

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? String(value) : value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Shortens long text so one wide value cannot flood an agent's context. Zero disables the limit. */
export function clipValue(value: unknown, maxChars: number): unknown {
  if (maxChars === 0) return value
  if (typeof value === 'string' && value.length > maxChars) {
    return `${value.slice(0, maxChars)}…[${value.length - maxChars} more characters]`
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const text = JSON.stringify(value)
    if (text.length > maxChars) return `${text.slice(0, maxChars)}…[${text.length - maxChars} more characters]`
  }
  return value
}

function tableCell(value: unknown): string {
  const text = displayValue(value).replace(/\r?\n/g, '↵').replace(/\t/g, ' ')
  return text.length > MAX_TABLE_CELL_WIDTH ? `${text.slice(0, MAX_TABLE_CELL_WIDTH - 1)}…` : text
}

export function renderTable({ columns, rows }: Table): string {
  if (columns.length === 0) return ''
  const cells = rows.map((row) => columns.map((_, index) => tableCell(row[index])))
  const header = columns.map(tableCell)
  const widths = header.map((label, index) => Math.max(label.length, ...cells.map((row) => row[index].length)))
  const line = (values: string[]): string => values.map((value, index) => value.padEnd(widths[index])).join('  ').trimEnd()
  return [line(header), widths.map((width) => '-'.repeat(width)).join('  '), ...cells.map(line)].join('\n')
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = displayValue(value)
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function renderCsv({ columns, rows }: Table): string {
  return [columns, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n')
}

const isPlainValue = (value: unknown): boolean => value === null || typeof value !== 'object' || value instanceof Date

/**
 * Indented JSON that keeps arrays of plain values, such as result rows and column lists, on one
 * line. Rows stay readable and an agent's context is not spent on one line per cell.
 */
export function renderJson(value: unknown, indent = ''): string {
  const normalized = typeof value === 'bigint' ? value.toString() : value
  if (normalized === undefined) return 'null'
  if (isPlainValue(normalized)) return JSON.stringify(normalized)
  const inner = `${indent}  `
  if (Array.isArray(normalized)) {
    if (normalized.length === 0) return '[]'
    if (normalized.every(isPlainValue)) return `[${normalized.map((item) => renderJson(item)).join(', ')}]`
    return `[\n${normalized.map((item) => `${inner}${renderJson(item, inner)}`).join(',\n')}\n${indent}]`
  }
  const entries = Object.entries(normalized as Record<string, unknown>).filter(([, item]) => item !== undefined)
  if (entries.length === 0) return '{}'
  return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${renderJson(item, inner)}`).join(',\n')}\n${indent}}`
}
