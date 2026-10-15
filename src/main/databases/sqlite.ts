import { DatabaseSync } from 'node:sqlite'
import type { DatabaseObject, QueryResult, SchemaColumn, SqliteConnection } from '../../shared/types'
import { serializeRows } from './common'
import { DatabaseSessionCache } from './session-cache'

const sessions = new DatabaseSessionCache<DatabaseSync>((database) => database.close())

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export function getSqliteSchema(connection: SqliteConnection): Promise<DatabaseObject[]> {
  return sessions.run(connection.id, connection.path, () => new DatabaseSync(connection.path), (database) => {
    const entries = database.prepare(`
      SELECT name, type, tbl_name AS parentName FROM sqlite_schema
      WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all() as { name: string; type: 'table' | 'view' | 'trigger'; parentName: string }[]

    return entries.map((entry) => {
      if (entry.type === 'trigger') return { ...entry, columns: [] }
      const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(entry.name)})`).all() as Array<{
        name: string
        type: string
        notnull: number
        pk: number
      }>
      return {
        name: entry.name,
        type: entry.type,
        columns: columns.map((column): SchemaColumn => ({
          name: column.name,
          type: column.type || 'ANY',
          nullable: column.notnull === 0,
          primaryKey: column.pk > 0
        }))
      }
    })
  })
}

export function executeSqliteQuery(connection: SqliteConnection, query: string): Promise<QueryResult> {
  return sessions.run(connection.id, connection.path, () => new DatabaseSync(connection.path), (database) => {
    const startedAt = performance.now()
    const statement = database.prepare(query)
    const columns = statement.columns().map((column) => column.name)
    if (columns.length > 0) {
      const rows = serializeRows(statement.all() as Record<string, unknown>[])
      return { columns, rows, rowCount: rows.length, durationMs: performance.now() - startedAt }
    }

    const result = statement.run()
    const changes = Number(result.changes)
    return {
      columns: [],
      rows: [],
      rowCount: changes,
      durationMs: performance.now() - startedAt,
      message: `${changes} row${changes === 1 ? '' : 's'} affected`
    }
  })
}

export function closeSqliteConnection(connectionId: string): Promise<void> {
  return sessions.closeConnection(connectionId)
}

export function closeAllSqliteConnections(): Promise<void> {
  return sessions.closeAll()
}

