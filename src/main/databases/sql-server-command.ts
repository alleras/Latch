import type { QueryResult } from '../../shared/types'
import { sqlServerResultType } from './column-types'
import { limitRows, rowsAffectedMessage, serializeRows } from './common'

interface SqlServerInfoMessage {
  message?: unknown
}

interface SqlServerArrayColumn {
  name: string
  type: unknown
  length: number
  precision?: number
  scale?: number
}

interface SqlServerArrayRecordset extends Array<unknown[]> {
  columns?: SqlServerArrayColumn[]
}

interface SqlServerArrayResult {
  recordsets?: SqlServerArrayRecordset[]
  rowsAffected?: number[]
}

interface SqlServerBatchRequest {
  multiple: boolean
  arrayRowMode: boolean
  on: (event: 'info', listener: (message: SqlServerInfoMessage) => void) => unknown
  batch: (query: string) => Promise<unknown>
}

export async function runSqlServerBatch(request: SqlServerBatchRequest, query: string, maxRows?: number): Promise<QueryResult> {
  const startedAt = performance.now()
  const infoMessages: string[] = []
  request.multiple = true
  request.arrayRowMode = true
  request.on('info', (info) => {
    if (typeof info.message !== 'string') return
    const message = info.message.trim()
    if (message) infoMessages.push(message)
  })

  const response = await request.batch(query) as SqlServerArrayResult
  const durationMs = performance.now() - startedAt
  const affected = (response.rowsAffected ?? []).reduce((total, count) => total + count, 0)
  const resultSets = (response.recordsets ?? []).map((recordset) => {
    const columns = recordset.columns ?? []
    const { rows, truncated } = limitRows(recordset, maxRows)
    return {
      columns: columns.map((column) => column.name),
      columnTypes: columns.map(sqlServerResultType),
      rows: serializeRows(rows),
      rowCount: rows.length,
      ...(truncated ? { truncated } : {})
    }
  })
  const commandMessages = resultSets.length > 0
    ? []
    : [affected > 0 ? rowsAffectedMessage(affected) : 'Command completed successfully']

  return {
    resultSets,
    durationMs,
    messages: [...infoMessages, ...commandMessages]
  }
}
