import { safeStorage } from 'electron'
import mysql, { type FieldPacket, type Pool } from 'mysql2/promise'
import type { DatabaseObject, QueryResult, SchemaConstraint, SchemaDefault, SchemaIndex } from '../../shared/types'
import type { StoredServerConnection } from '../types'
import { pushGrouped, relationKey, serializeRows } from './common'
import { DatabaseSessionCache } from './session-cache'

type MySqlConnection = StoredServerConnection & { provider: 'mysql' }

const sessions = new DatabaseSessionCache<Pool>((pool) => pool.end())

function createPool(connection: MySqlConnection, database?: string): Pool {
  return mysql.createPool({
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password: safeStorage.decryptString(Buffer.from(connection.encryptedPassword, 'base64')),
    database: database ?? connection.initialDatabase,
    connectTimeout: 12_000,
    ssl: connection.ssl ? { rejectUnauthorized: !connection.trustServerCertificate } : undefined,
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 5 * 60 * 1000,
    enableKeepAlive: true
  })
}

function withPool<T>(connection: MySqlConnection, database: string | undefined, task: (pool: Pool) => Promise<T>): Promise<T> {
  const selectedDatabase = database ?? connection.initialDatabase ?? ''
  return sessions.run(connection.id, selectedDatabase, () => createPool(connection, database), task)
}

export async function testMySql(connection: MySqlConnection): Promise<void> {
  await withPool(connection, undefined, async (pool) => { await pool.query('SELECT 1 AS connected') })
}

export async function listMySqlDatabases(connection: MySqlConnection): Promise<string[]> {
  return withPool(connection, undefined, async (pool) => {
    const [rows] = await pool.query('SHOW DATABASES')
    return (rows as Array<{ Database: string }>).map((row) => row.Database)
  })
}

export async function getMySqlSchema(connection: MySqlConnection, database: string): Promise<DatabaseObject[]> {
  return withPool(connection, database, async (pool) => {
    const [[tableRows], [columnRows], [constraintRows], [indexRows], [routineRows], [triggerRows]] = await Promise.all([
      pool.execute(`
        SELECT TABLE_NAME AS name, TABLE_TYPE AS type
        FROM information_schema.tables
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME
      `, [database]),
      pool.execute(`
        SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS type,
          IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue
        FROM information_schema.columns
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION
      `, [database]),
      pool.execute(`
        SELECT tc.TABLE_NAME AS tableName, tc.CONSTRAINT_NAME AS name, tc.CONSTRAINT_TYPE AS type,
          kcu.COLUMN_NAME AS columnName, kcu.ORDINAL_POSITION AS ordinalPosition,
          kcu.REFERENCED_TABLE_SCHEMA AS referencedSchema, kcu.REFERENCED_TABLE_NAME AS referencedTable,
          kcu.REFERENCED_COLUMN_NAME AS referencedColumn, rc.UPDATE_RULE AS onUpdate, rc.DELETE_RULE AS onDelete,
          cc.CHECK_CLAUSE AS expression
        FROM information_schema.TABLE_CONSTRAINTS tc
        LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
          ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND kcu.TABLE_NAME = tc.TABLE_NAME AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON rc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
          ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE tc.TABLE_SCHEMA = ?
        ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
      `, [database]),
      pool.execute(`
        SELECT TABLE_NAME AS tableName, INDEX_NAME AS name, NON_UNIQUE AS nonUnique,
          INDEX_TYPE AS type, SEQ_IN_INDEX AS ordinalPosition, COLUMN_NAME AS columnName,
          COLLATION AS collation, SUB_PART AS prefixLength
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
      `, [database]),
      pool.execute(`
        SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
        FROM information_schema.routines
        WHERE ROUTINE_SCHEMA = ?
        ORDER BY ROUTINE_NAME
      `, [database]),
      pool.execute(`
        SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS parentName
        FROM information_schema.triggers
        WHERE TRIGGER_SCHEMA = ?
        ORDER BY TRIGGER_NAME
      `, [database])
    ])
    const tables = tableRows as Array<{ name: string; type: string }>
    const columns = columnRows as Array<{ tableName: string; name: string; type: string; nullable: string; defaultValue: unknown }>
    const constraintParts = constraintRows as Array<{
      tableName: string
      name: string
      type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'CHECK'
      columnName: string | null
      ordinalPosition: number | null
      referencedSchema: string | null
      referencedTable: string | null
      referencedColumn: string | null
      onUpdate: string | null
      onDelete: string | null
      expression: string | null
    }>
    const indexParts = indexRows as Array<{
      tableName: string
      name: string
      nonUnique: number
      type: string
      ordinalPosition: number
      columnName: string | null
      collation: 'A' | 'D' | null
      prefixLength: number | null
    }>
    const routines = routineRows as Array<{ name: string; type: 'PROCEDURE' | 'FUNCTION' }>
    const triggers = triggerRows as Array<{ name: string; parentName: string }>

    const columnsByRelation = new Map<string, typeof columns>()
    for (const column of columns) pushGrouped(columnsByRelation, relationKey(undefined, column.tableName), column)
    const constraintsByRelation = new Map<string, SchemaConstraint[]>()
    const constraintByIdentity = new Map<string, SchemaConstraint>()
    for (const part of constraintParts) {
      const relation = relationKey(undefined, part.tableName)
      const identity = relationKey(relation, part.name)
      let constraint = constraintByIdentity.get(identity)
      if (!constraint) {
        const type = part.type === 'PRIMARY KEY' ? 'primary-key'
          : part.type === 'FOREIGN KEY' ? 'foreign-key'
            : part.type === 'UNIQUE' ? 'unique' : 'check'
        constraint = {
          name: part.name,
          type,
          columns: [],
          referencedSchema: part.referencedSchema ?? undefined,
          referencedTable: part.referencedTable ?? undefined,
          referencedColumns: part.referencedTable ? [] : undefined,
          expression: part.expression ?? undefined,
          onUpdate: part.onUpdate ?? undefined,
          onDelete: part.onDelete ?? undefined
        }
        constraintByIdentity.set(identity, constraint)
        pushGrouped(constraintsByRelation, relation, constraint)
      }
      if (part.columnName) constraint.columns.push(part.columnName)
      if (part.referencedColumn) constraint.referencedColumns?.push(part.referencedColumn)
    }
    const indexesByRelation = new Map<string, SchemaIndex[]>()
    const indexByIdentity = new Map<string, SchemaIndex>()
    for (const part of indexParts) {
      const relation = relationKey(undefined, part.tableName)
      const identity = relationKey(relation, part.name)
      let index = indexByIdentity.get(identity)
      if (!index) {
        index = { name: part.name, unique: part.nonUnique === 0, primary: part.name === 'PRIMARY', type: part.type, columns: [] }
        indexByIdentity.set(identity, index)
        pushGrouped(indexesByRelation, relation, index)
      }
      index.columns.push({
        name: part.columnName ?? undefined,
        expression: part.columnName === null ? '<expression>' : undefined,
        descending: part.collation === 'D',
        included: false,
        prefixLength: part.prefixLength ?? undefined
      })
    }
    const relations: DatabaseObject[] = tables.map((table) => ({
      name: table.name,
      type: table.type === 'VIEW' ? 'view' : 'table',
      columns: (columnsByRelation.get(relationKey(undefined, table.name)) ?? []).map((column) => ({
        name: column.name,
        type: column.type.toUpperCase(),
        nullable: column.nullable === 'YES',
        primaryKey: (constraintsByRelation.get(relationKey(undefined, table.name)) ?? [])
          .some((constraint) => constraint.type === 'primary-key' && constraint.columns.includes(column.name))
      })),
      constraints: constraintsByRelation.get(relationKey(undefined, table.name)) ?? [],
      indexes: indexesByRelation.get(relationKey(undefined, table.name)) ?? [],
      defaults: (columnsByRelation.get(relationKey(undefined, table.name)) ?? []).flatMap<SchemaDefault>((column) => (
        column.defaultValue === null ? [] : [{ column: column.name, expression: String(column.defaultValue) }]
      ))
    }))
    return [
      ...relations,
      ...routines.map((routine) => ({
        name: routine.name,
        type: routine.type === 'PROCEDURE' ? 'procedure' as const : 'function' as const,
        columns: [],
        constraints: [],
        indexes: [],
        defaults: []
      })),
      ...triggers.map((trigger) => ({ ...trigger, type: 'trigger' as const, columns: [], constraints: [], indexes: [], defaults: [] }))
    ]
  })
}

export async function executeMySqlQuery(connection: MySqlConnection, database: string, query: string): Promise<QueryResult> {
  return withPool(connection, database, async (pool) => {
    const startedAt = performance.now()
    const [result, fields] = await pool.query(query)
    const durationMs = performance.now() - startedAt
    const isRows = Array.isArray(result)
    const rows = isRows ? serializeRows(result as Record<string, unknown>[]) : []
    const columns = fields?.map((field: FieldPacket) => field.name) ?? []
    const affected = isRows ? rows.length : Number((result as { affectedRows?: number }).affectedRows ?? 0)
    return {
      columns,
      rows,
      rowCount: affected,
      durationMs,
      message: columns.length ? undefined : `${affected} row${affected === 1 ? '' : 's'} affected`
    }
  })
}

export function closeMySqlConnection(connectionId: string): Promise<void> {
  return sessions.closeConnection(connectionId)
}

export function closeAllMySqlConnections(): Promise<void> {
  return sessions.closeAll()
}
