import { DatabaseSync } from 'node:sqlite'
import type { DatabaseObject, QueryResult, SchemaColumn, SchemaConstraint, SchemaIndex, SqliteConnection } from '../../shared/types'
import { rowsAffectedMessage, serializeRows } from './common'
import { DatabaseSessionCache } from './session-cache'
import { isTransactionControlStatement, splitSqlStatements } from './sql-statements'

const sessions = new DatabaseSessionCache<DatabaseSync>((database) => database.close())

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function sqliteCheckConstraints(definition: string | null): SchemaConstraint[] {
  if (!definition) return []
  const constraints: SchemaConstraint[] = []
  let quote: string | null = null

  for (let index = 0; index < definition.length; index += 1) {
    const character = definition[index]
    if (quote) {
      if (character === quote) {
        if (definition[index + 1] === quote) index += 1
        else quote = null
      } else if (quote === ']' && character === ']') {
        quote = null
      }
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '[') {
      quote = ']'
      continue
    }
    if (definition.slice(index, index + 5).toUpperCase() !== 'CHECK') continue
    if (/\w/.test(definition[index - 1] ?? '') || /\w/.test(definition[index + 5] ?? '')) continue

    let open = index + 5
    while (/\s/.test(definition[open] ?? '')) open += 1
    if (definition[open] !== '(') continue

    let depth = 0
    let innerQuote: string | null = null
    let close = open
    for (; close < definition.length; close += 1) {
      const innerCharacter = definition[close]
      if (innerQuote) {
        if (innerCharacter === innerQuote) {
          if (definition[close + 1] === innerQuote) close += 1
          else innerQuote = null
        } else if (innerQuote === ']' && innerCharacter === ']') {
          innerQuote = null
        }
        continue
      }
      if (innerCharacter === "'" || innerCharacter === '"' || innerCharacter === '`') innerQuote = innerCharacter
      else if (innerCharacter === '[') innerQuote = ']'
      else if (innerCharacter === '(') depth += 1
      else if (innerCharacter === ')' && --depth === 0) break
    }
    if (depth !== 0) continue

    const prefix = definition.slice(0, index)
    const named = prefix.match(/\bCONSTRAINT\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([^\s,()]+))\s*$/i)
    constraints.push({
      name: named?.slice(1).find(Boolean) ?? `CHECK ${constraints.length + 1}`,
      type: 'check',
      columns: [],
      expression: definition.slice(index, close + 1)
    })
    index = close
  }
  return constraints
}

export function getSqliteSchema(connection: SqliteConnection): Promise<DatabaseObject[]> {
  return sessions.run(connection.id, connection.path, () => new DatabaseSync(connection.path), (database) => {
    const entries = database.prepare(`
      SELECT name, type, tbl_name AS parentName, sql AS definition FROM sqlite_schema
      WHERE type IN ('table', 'view', 'trigger') AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all() as { name: string; type: 'table' | 'view' | 'trigger'; parentName: string; definition: string | null }[]

    return entries.map((entry): DatabaseObject => {
      if (entry.type === 'trigger') return { ...entry, columns: [], constraints: [], indexes: [], defaults: [] }
      const columnRows = database.prepare(`PRAGMA table_xinfo(${quoteIdentifier(entry.name)})`).all() as Array<{
        name: string
        type: string
        notnull: number
        pk: number
        dflt_value: unknown
      }>
      const columns = columnRows.map((column): SchemaColumn => ({
        name: column.name,
        type: column.type || 'ANY',
        nullable: column.notnull === 0 && column.pk === 0,
        primaryKey: column.pk > 0
      }))
      const constraints: SchemaConstraint[] = sqliteCheckConstraints(entry.definition)
      const primaryColumns = [...columnRows]
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name)
      if (primaryColumns.length > 0) {
        constraints.push({ name: 'PRIMARY KEY', type: 'primary-key', columns: primaryColumns })
      }

      const indexes: SchemaIndex[] = []
      if (entry.type === 'table') {
        const indexRows = database.prepare(`PRAGMA index_list(${quoteIdentifier(entry.name)})`).all() as Array<{
          name: string
          unique: number
          origin: 'c' | 'u' | 'pk'
          partial: number
        }>
        for (const index of indexRows) {
          const indexColumns = database.prepare(`PRAGMA index_xinfo(${quoteIdentifier(index.name)})`).all() as Array<{
            seqno: number
            cid: number
            name: string | null
            desc: number
            key: number
          }>
          const definition = database.prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?').get('index', index.name) as { sql: string | null } | undefined
          const predicate = definition?.sql?.match(/\bWHERE\s+(.+)$/is)?.[1]?.trim()
          const schemaIndex: SchemaIndex = {
            name: index.name,
            unique: index.unique === 1,
            primary: index.origin === 'pk',
            type: 'BTREE',
            columns: indexColumns
              .filter((column) => column.key === 1)
              .sort((left, right) => left.seqno - right.seqno)
              .map((column) => ({
                name: column.name ?? undefined,
                expression: column.name === null ? '<expression>' : undefined,
                descending: column.desc === 1,
                included: false
              })),
            predicate
          }
          indexes.push(schemaIndex)
          if (index.origin === 'u') {
            constraints.push({
              name: index.name,
              type: 'unique',
              columns: schemaIndex.columns.flatMap((column) => column.name ? [column.name] : [])
            })
          }
        }

        const foreignKeyRows = database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(entry.name)})`).all() as Array<{
          id: number
          seq: number
          table: string
          from: string
          to: string | null
          on_update: string
          on_delete: string
        }>
        const foreignKeys = new Map<number, typeof foreignKeyRows>()
        for (const foreignKey of foreignKeyRows) {
          const current = foreignKeys.get(foreignKey.id) ?? []
          current.push(foreignKey)
          foreignKeys.set(foreignKey.id, current)
        }
        for (const [id, rows] of foreignKeys) {
          rows.sort((left, right) => left.seq - right.seq)
          constraints.push({
            name: `FOREIGN KEY ${id + 1}`,
            type: 'foreign-key',
            columns: rows.map((row) => row.from),
            referencedTable: rows[0].table,
            referencedColumns: rows.flatMap((row) => row.to ? [row.to] : []),
            onUpdate: rows[0].on_update,
            onDelete: rows[0].on_delete
          })
        }
      }

      return {
        name: entry.name,
        type: entry.type,
        columns,
        constraints,
        indexes,
        defaults: columnRows.flatMap((column) => column.dflt_value === null
          ? []
          : [{ column: column.name, expression: String(column.dflt_value) }])
      }
    })
  })
}

export function executeSqliteQuery(connection: SqliteConnection, query: string, sessionId: string): Promise<QueryResult> {
  const sessionKey = JSON.stringify([connection.path, sessionId])
  return sessions.run(connection.id, sessionKey, () => new DatabaseSync(connection.path), (database) => {
    const startedAt = performance.now()
    const resultSets: QueryResult['resultSets'] = []
    const messages: string[] = []
    for (const sql of splitSqlStatements(query)) {
      const statement = database.prepare(sql)
      const metadata = statement.columns()
      if (metadata.length > 0) {
        const supportsArrays = typeof statement.setReturnArrays === 'function'
        if (supportsArrays) statement.setReturnArrays(true)
        const rawRows = statement.all()
        const rows = serializeRows(supportsArrays
          ? rawRows as unknown as unknown[][]
          : (rawRows as Record<string, unknown>[]).map((row) => metadata.map((column) => row[column.name])))
        resultSets.push({
          columns: metadata.map((column) => column.name),
          columnTypes: metadata.map((column) => column.type),
          rows,
          rowCount: rows.length
        })
        continue
      }

      const result = statement.run()
      const changes = Number(result.changes)
      messages.push(changes > 0 && !isTransactionControlStatement(sql) ? rowsAffectedMessage(changes) : 'Command completed successfully')
    }
    return {
      resultSets,
      durationMs: performance.now() - startedAt,
      messages
    }
  })
}

export function closeSqliteConnection(connectionId: string): Promise<void> {
  return sessions.closeConnection(connectionId)
}

export function closeAllSqliteConnections(): Promise<void> {
  return sessions.closeAll()
}
