import { safeStorage } from 'electron'
import mysql, { type FieldPacket, type Pool } from 'mysql2/promise'
import type { DatabaseObject, QueryResult } from '../../shared/types'
import type { StoredServerConnection } from '../types'
import { serializeRows } from './common'
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
    const [tableRows] = await pool.execute(`
      SELECT TABLE_NAME AS name, TABLE_TYPE AS type
      FROM information_schema.tables
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME
    `, [database])
    const [columnRows] = await pool.execute(`
      SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS type,
        IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey
      FROM information_schema.columns
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `, [database])
    const [routineRows] = await pool.execute(`
      SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
      FROM information_schema.routines
      WHERE ROUTINE_SCHEMA = ?
      ORDER BY ROUTINE_NAME
    `, [database])
    const [triggerRows] = await pool.execute(`
      SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS parentName
      FROM information_schema.triggers
      WHERE TRIGGER_SCHEMA = ?
      ORDER BY TRIGGER_NAME
    `, [database])
    const tables = tableRows as Array<{ name: string; type: string }>
    const columns = columnRows as Array<{ tableName: string; name: string; type: string; nullable: string; columnKey: string }>
    const routines = routineRows as Array<{ name: string; type: 'PROCEDURE' | 'FUNCTION' }>
    const triggers = triggerRows as Array<{ name: string; parentName: string }>
    const relations: DatabaseObject[] = tables.map((table) => ({
      name: table.name,
      type: table.type === 'VIEW' ? 'view' : 'table',
      columns: columns
        .filter((column) => column.tableName === table.name)
        .map((column) => ({ name: column.name, type: column.type.toUpperCase(), nullable: column.nullable === 'YES', primaryKey: column.columnKey === 'PRI' }))
    }))
    return [
      ...relations,
      ...routines.map((routine) => ({
        name: routine.name,
        type: routine.type === 'PROCEDURE' ? 'procedure' as const : 'function' as const,
        columns: []
      })),
      ...triggers.map((trigger) => ({ ...trigger, type: 'trigger' as const, columns: [] }))
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

