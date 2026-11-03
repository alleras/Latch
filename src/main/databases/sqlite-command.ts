import { existsSync } from 'node:fs'
import type { QueryResult, SqliteConnection } from '../../shared/types'
import type { BoundedQueryOptions } from '../types'
import { rowsAffectedMessage, serializeRows } from './common'
import { isTransactionControlStatement, splitSqlStatements } from './sql-statements'
import { openSqliteDatabase } from './sqlite-open'

/**
 * Runs one command line query on its own handle. Read-only queries open the file read-only, so
 * SQLite itself rejects writes. Rows are read one at a time and reading stops at the row limit.
 * SQLite runs synchronously, so `timeoutMs` only bounds waiting for a locked database.
 */
export function executeSqliteBoundedQuery(connection: SqliteConnection, query: string, options: BoundedQueryOptions): QueryResult {
  if (!existsSync(connection.path)) throw new Error(`The database file ${connection.path} does not exist.`)
  const database = openSqliteDatabase(connection.path, { readOnly: options.readOnly, timeout: Math.max(1, Math.floor(options.timeoutMs)) })
  try {
    const startedAt = performance.now()
    const resultSets: QueryResult['resultSets'] = []
    const messages: string[] = []
    for (const sql of splitSqlStatements(query)) {
      const statement = database.prepare(sql)
      const metadata = statement.columns()
      if (metadata.length === 0) {
        const changes = Number(statement.run().changes)
        messages.push(changes > 0 && !isTransactionControlStatement(sql) ? rowsAffectedMessage(changes) : 'Command completed successfully')
        continue
      }
      statement.setReturnArrays(true)
      const rows: unknown[][] = []
      let truncated = false
      for (const row of statement.iterate() as Iterable<unknown>) {
        if (rows.length === options.maxRows) {
          truncated = true
          break
        }
        rows.push(row as unknown[])
      }
      resultSets.push({
        columns: metadata.map((column) => column.name),
        columnTypes: metadata.map((column) => column.type),
        rows: serializeRows(rows),
        rowCount: rows.length,
        ...(truncated ? { truncated } : {})
      })
    }
    return { resultSets, durationMs: performance.now() - startedAt, messages }
  } finally {
    database.close()
  }
}
